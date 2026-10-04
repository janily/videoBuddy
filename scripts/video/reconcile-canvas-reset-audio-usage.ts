import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {z} from 'zod';
import {FileStore} from '../../src/services/video/storage/file-store';
import {canonicalHash,canonicalJson} from '../../src/services/video/domain/hash';
import {settleModelUsage,type ModelReservation} from '../../src/services/video/budget/model-budget';
import {loadStageKnowledge} from '../../src/services/video/styles/knowledge-loader';
import {revisionSeed} from '../../src/services/video/timeline/seed';
import {claimProbeReport,persistProbeReport} from './helpers/probe-report';

async function main(){
 if(!process.argv.includes('--reconcile-captured-audio-usage'))throw Error('EXPLICIT_RECONCILIATION_REQUIRED');
 const evidence=JSON.parse(await readFile('docs/engineering/evidence/new-theme-canvas-reset-preview-probe.json','utf8')),op=evidence.stages.operation;
 if(evidence.status!=='blocked'||op.status!=='failed'||op.stage!=='audio'||evidence.requests.length!==1)throw Error('SINGLE_TERMINAL_REQUEST_REQUIRED');
 const request=evidence.requests[0];if(request.status!==200||request.model!=='gemini-3.8-flash'||!/^model-diagnostics\/[a-f0-9]{64}\.json$/.test(request.responseFile))throw Error('RAW_RESPONSE_REQUIRED');
 const bytes=await readFile(join(evidence.root,request.responseFile));if(createHash('sha256').update(bytes).digest('hex')!==request.responseSha256)throw Error('RAW_RESPONSE_CHANGED');
 const raw=JSON.parse(bytes.toString()),providerUsage=z.strictObject({inputTokens:z.number().int().nonnegative(),outputTokens:z.number().int().nonnegative()}).parse({inputTokens:raw.usage?.prompt_tokens,outputTokens:raw.usage?.completion_tokens});
 if(raw.model!==request.model||raw.choices.length!==1||raw.choices[0].finish_reason!=='stop'||raw.usage.total_tokens!==providerUsage.inputTokens+providerUsage.outputTokens||canonicalHash(raw.usage)!==canonicalHash(request.usage))throw Error('RAW_RESPONSE_AMBIGUOUS');
 const store=new FileStore(evidence.root),prefix=`projects/${op.projectId}`,revisionPrefix=prefix+'/revisions/'+op.revisionId;
 const controlKey=prefix+'/control',operationKey=prefix+'/operations/'+op.id,effectKey=operationKey+'/effects/audio/'+op.revisionId;
 const preservedKeys=[controlKey,operationKey,effectKey],preserved=await Promise.all(preservedKeys.map(async key=>canonicalHash((await store.readFresh(key)).value)));
 if(canonicalHash(op)!==preserved[1])throw Error('SOURCE_OPERATION_CHANGED');
 const understanding=(await store.readFresh<import('../../src/contracts/video/domain').Understanding>(op.understandingRef.key)).value;
 const treatmentKeys=await store.listKeys(revisionPrefix+'/treatment-plan',1);if(treatmentKeys.length!==1)throw Error('SOURCE_CONTEXT_CHANGED');
 const treatment=(await store.readFresh(treatmentKeys[0])).value,timingStage=(await store.readFresh<{draftRef:{key:string;sha256:string}}>(revisionPrefix+'/timing-stage')).value,timing=(await store.readFresh<import('../../src/services/video/preview/timing-draft').TimingDraft>(timingStage.draftRef.key)).value;
 const seed=revisionSeed(op.projectId,op.revisionId),outputText=raw.choices[0].message.content,output=JSON.parse(outputText.replace(/^```json\s*/,'').replace(/\s*```$/,''));
 if(output.seed!==seed||output.timingDraftHash!==timingStage.draftRef.sha256||output.$schema!=='http://json-schema.org/draft-07/schema#')throw Error('RAW_RESPONSE_CONTEXT_CHANGED');
 const knowledge=await loadStageKnowledge(understanding.preferences.styleSlug!,'style'),contextBytes=Buffer.byteLength(canonicalJson({understanding,treatment,timing:{...timing,track:{sha256:timing.track.sha256,samples:timing.track.samples,silence:timing.track.silence}},seed}))+Buffer.byteLength(knowledge.rules);
 const cost={inputTokens:contextBytes+4096,outputTokens:12000},stage=op.id+'-audio-'+op.revisionId,id=canonicalHash({projectId:op.projectId,stage}),hash=canonicalHash(cost),intent=(await store.readFresh<{day:string;hash:string;mode:'unlimited_validation'}>(prefix+'/budget-intents/'+id)).value;
 if(intent.hash!==hash||intent.mode!=='unlimited_validation')throw Error('RESERVATION_CHANGED');
 const beforeBudget=(await store.readFresh<{accounting:Record<string,{state:string;startedAt:string}>}>(prefix+'/budget')).value,entry=beforeBudget.accounting[id];
 if(entry?.state!=='unknown'||Math.abs(Date.parse(request.startedAt)-Date.parse(entry.startedAt))>1000)throw Error('REQUEST_BINDING_CHANGED');
 const reservation:ModelReservation={projectId:op.projectId,stage,id,day:intent.day,hash,cost,mode:intent.mode},path='docs/engineering/evidence/canvas-reset-audio-usage-reconciliation.json',report:{[key:string]:unknown}={executedAt:new Date().toISOString(),projectId:op.projectId,operationId:op.id,reservationId:id,responseSha256:request.responseSha256,sourceReport:'new-theme-canvas-reset-preview-probe.json',status:'started',usage:providerUsage,policy:'Settle only the captured HTTP200 usage after strict output rejection. No effect result repair, retries, refunds or operation/control mutation.'};
 await claimProbeReport(path,report);
 try{report.settlement=await settleModelUsage(store,reservation,providerUsage);report.status='usage_settled';report.budget=(await store.readFresh(prefix+'/budget')).value;report.gate=(await store.readFresh('budgets/model-gate')).value}catch(error){report.status='blocked';report.errorCode=(error as Error).message;process.exitCode=1}
 report.sourceStateUnchanged=canonicalHash(preserved)===canonicalHash(await Promise.all(preservedKeys.map(async key=>canonicalHash((await store.readFresh(key)).value))));
 await persistProbeReport(path,report);console.log(JSON.stringify({status:report.status,usage:report.usage,sourceStateUnchanged:report.sourceStateUnchanged}));
}
main().catch(error=>{console.error(JSON.stringify({status:'blocked',errorCode:error.message}));process.exitCode=1});
