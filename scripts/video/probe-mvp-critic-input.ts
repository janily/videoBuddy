import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {FileStore} from '../../src/services/video/storage/file-store';
import {canonicalHash} from '../../src/services/video/domain/hash';
import {visualReviewContext,type VisualReviewContext} from '../../src/contracts/video/visual-review';
import {readVisualEvidence,type VisualEvidence} from '../../src/services/video/quality/visual-evidence';
import {runVisualCritic} from '../../src/mastra/video/critic';
import {reserveModelBudget,modelLimits} from '../../src/services/video/budget/model-budget';
import {withAccountedModel} from '../../src/services/video/budget/model-call';
import {runEffect} from '../../src/services/video/commands/effect-ledger';
import {requireUnlimitedValidation} from '../../src/services/video/budget/validation-authorization';
import {recordModelRequests} from './helpers/real-probe';
import {claimProbeReport,persistProbeReport} from './helpers/probe-report';
async function main(){
 if(process.argv.slice(2).join(' ')!=='--diagnose-two-real-frames')throw Error('MVP_DIAGNOSTIC_OPT_IN_REQUIRED');
 const candidateRoot=process.env.VIDEO_DATA_DIR;if(!candidateRoot)throw Error('CONFIGURATION_REQUIRED');const root:string=candidateRoot;
 const closure=JSON.parse(await readFile('docs/engineering/evidence/mvp-browser-closure.json','utf8')),projectId=closure.projectId,formal=closure.smallBatchFormal,store=new FileStore(root),prefix=`projects/${projectId}/`,operationKey=prefix+'operations/'+formal.operationId;
 const operation=(await store.readFresh<{status:string}>(operationKey)).value;if(operation.status!=='failed')throw Error('MVP_DIAGNOSTIC_FAILED_SOURCE_REQUIRED');
 const control=(await store.readFresh(prefix+'control')).value,sourceHash=canonicalHash({control,operation}),approvalPrefix=prefix+'approvals/'+formal.approvalId+'/',stage=(await store.readFresh<{batches:Array<{contextRef:{key:string};evidenceRef:{key:string}}> }>(approvalPrefix+'visual-evidence-v1-stage')).value,batch=stage.batches[0],fullContext=(await store.readFresh<VisualReviewContext>(batch.contextRef.key)).value,evidence=(await store.readFresh<VisualEvidence>(batch.evidenceRef.key)).value;
 const allImages=await readVisualEvidence(root,evidence),{frameSetSha256,...raw}=fullContext;void frameSetSha256;
 const context=visualReviewContext({...raw,frames:raw.frames.slice(0,2)}),images=new Map(context.frames.map(f=>[f.id,allImages.get(f.id)!])),id=randomUUID(),path='docs/engineering/evidence/mvp-two-frame-critic-diagnostic.json',report:Record<string,unknown>={observedAt:new Date().toISOString(),status:'running',sourceOperationId:formal.operationId,projectId,diagnosticId:id,context,frameBytes:context.frames.reduce((n,f)=>n+f.bytes,0),newNativeCalls:0,productionApproval:false,resultPublished:false};
 await requireUnlimitedValidation(store);await claimProbeReport(path,report);
 async function assertSource(){const now={control:(await store.readFresh(prefix+'control')).value,operation:(await store.readFresh(operationKey)).value};if(canonicalHash(now)!==sourceHash)throw Error('MVP_DIAGNOSTIC_SOURCE_CHANGED');await readVisualEvidence(root,evidence)}
 const transport=recordModelRequests(process.env,root,1,{timeoutMs:600000});
 try{
  const reservation=await reserveModelBudget(store,projectId,'mvp-two-frame-diagnostic-'+id,{inputTokens:100000,outputTokens:8000},modelLimits(process.env));
  const review=await runEffect(store,prefix+'diagnostics/'+id+'/effect',()=>withAccountedModel(store,reservation.reservation,()=>runVisualCritic(context,images,reservation.maxOutputTokens,process.env,{assertActive:assertSource})));
  report.review=review;report.status='actual_two_frame_review_returned';
 }catch(error){report.status='failed';report.errorCode=(error as Error).message.split(':')[0].replaceAll(process.env.MODEL_API_KEY||'missing-key','[redacted]').slice(0,120);process.exitCode=1}
 finally{await transport.flush();transport.restore();report.requests=transport.requests;report.originalControlAndFailedOperationUnchanged=canonicalHash({control:(await store.readFresh(prefix+'control')).value,operation:(await store.readFresh(operationKey)).value})===sourceHash;await persistProbeReport(path,report);console.log(JSON.stringify({status:report.status,errorCode:report.errorCode,requests:transport.requests.length,originalControlAndFailedOperationUnchanged:report.originalControlAndFailedOperationUnchanged,resultPublished:false}))}
}
main().catch(error=>{console.error((error as Error).message.replaceAll(process.env.MODEL_API_KEY||'missing-key','[redacted]').slice(0,120));process.exitCode=1});
