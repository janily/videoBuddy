import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {FileStore} from '../../src/services/video/storage/file-store';
import {ProjectStore} from '../../src/services/video/storage/project-store';
import {readPreviewBundle} from '../../src/services/video/preview/commit';
import {verifyPreviewPackage} from '../../src/services/video/preview/package';
import {readNarrationJson,loadPackagedNarration} from '../../src/services/video/audio/narration-package';
import type {ObjectRef} from '../../src/contracts/video/domain';
import type {ApprovalRecord} from '../../src/services/video/preview/approve';
import {canonicalHash} from '../../src/services/video/domain/hash';
import {contentReviewContext,type ContentReviewContext} from '../../src/contracts/video/content-review';
import {readVisualEvidence,type VisualEvidence} from '../../src/services/video/quality/visual-evidence';
import {mvpFilmVisualPlan} from '../../src/services/video/quality/whole-visual-plan';
import {runContentCritic} from '../../src/mastra/video/content-critic';
import {reserveModelBudget,modelLimits} from '../../src/services/video/budget/model-budget';
import {withAccountedModel} from '../../src/services/video/budget/model-call';
import {runEffect} from '../../src/services/video/commands/effect-ledger';
import {requireUnlimitedValidation} from '../../src/services/video/budget/validation-authorization';
import {recordModelRequests} from './helpers/real-probe';
import {claimProbeReport,persistProbeReport} from './helpers/probe-report';
async function main(){
 if(process.argv.slice(2).join(' ')!=='--diagnose-complete-real-round')throw Error('MVP_DIAGNOSTIC_OPT_IN_REQUIRED');
 const candidateRoot=process.env.VIDEO_DATA_DIR;if(!candidateRoot)throw Error('CONFIGURATION_REQUIRED');const root:string=candidateRoot;
 const closure=JSON.parse(await readFile('docs/engineering/evidence/mvp-browser-closure.json','utf8')),projectId=closure.projectId,formal=closure.verifiedNarrationFormal,store=new FileStore(root),prefix=`projects/${projectId}/`,approvalPrefix=prefix+'approvals/'+formal.approvalId+'/';
 async function source(){
  const control=(await store.readFresh<{currentApprovalId:string;ownerKeyHash:string}>(prefix+'control')).value,operation=(await store.readFresh<{id:string;projectId:string;status:string;kind:string;approvalId:string;bundleHash:string}>(prefix+'operations/'+formal.operationId)).value,approval=(await store.readFresh<ApprovalRecord>(prefix+'approvals/'+formal.approvalId)).value;
  if(operation.status!=='failed'||operation.kind!=='render'||operation.id!==formal.operationId||operation.projectId!==projectId||operation.approvalId!==formal.approvalId||approval.projectId!==projectId||approval.approvalId!==formal.approvalId||approval.source!=='preview_button'||operation.bundleHash!==approval.bundleHash||control.currentApprovalId!==approval.approvalId||control.ownerKeyHash!==approval.ownerKeyHash)throw Error('MVP_DIAGNOSTIC_FAILED_SOURCE_REQUIRED');
  const projects=new ProjectStore(store),bundle=await readPreviewBundle(projects,projectId,approval.previewId,root),frozen=await verifyPreviewPackage(projects,projectId,bundle,root);
  if(approval.bundleHash!==bundle.bundleHash||approval.revisionId!==bundle.revisionId||approval.scriptHash!==bundle.scriptHash||approval.factsHash!==bundle.factsHash||approval.briefVersion!==bundle.briefVersion)throw Error('MVP_DIAGNOSTIC_SOURCE_CHANGED');
  const composition=(await store.readFresh<{inputHash:string;movie:{technicalQa:{sha256:string}};postMix:{status:string;lines:{lineId:string;recognizedText:string;sourceSha256:string;status:string}[]}}>(approvalPrefix+'composite-v2-stage')).value,visual=(await store.readFresh<{inputHash:string;compositionHash:string;plan:unknown;batches:{round:1|2;index:number;evidenceRef:ObjectRef}[]}>(approvalPrefix+'visual-evidence-v1-stage')).value,content=(await store.readFresh<{inputHash:string;compositionHash:string;batches:{round:1|2;index:number;contextRef:ObjectRef}[]}>(approvalPrefix+'content-review-v1-stage')).value;
  if(frozen.deliveryPolicy.schemaVersion!==2||visual.compositionHash!==canonicalHash(composition)||content.compositionHash!==canonicalHash(composition)||visual.inputHash!==composition.inputHash||content.inputHash!==composition.inputHash||canonicalHash(visual.plan)!==canonicalHash(mvpFilmVisualPlan(frozen.timeline,frozen.deliveryPolicy.visualSampling||'legacy'))||composition.postMix.status!=='pass')throw Error('MVP_DIAGNOSTIC_SOURCE_CHANGED');
  const batches=content.batches.filter(b=>b.round===1).sort((a,b)=>a.index-b.index);const contexts:ContentReviewContext[]=[],evidences:VisualEvidence[]=[],images=new Map<string,Uint8Array>();
  for(const batch of batches){
   const c=await readNarrationJson(store,batch.contextRef,approvalPrefix+'content-context/') as ContentReviewContext,{contextSha256,...raw}=c;if(contentReviewContext(raw).contextSha256!==contextSha256||c.filmSha256!==composition.movie.technicalQa.sha256||c.filmSpecSha256!==bundle.filmSpecRef.sha256||c.factsManifestSha256!==frozen.filmSpec.factsRef.sha256||canonicalHash(c.facts)!==canonicalHash(frozen.facts.facts)||canonicalHash(c.requirements)!==canonicalHash(frozen.contentRequirements!.requirements))throw Error('MVP_DIAGNOSTIC_SOURCE_CHANGED');
   for(const t of c.transcripts){const clock=frozen.timeline.narration.find(n=>n.lineId===t.id),line=composition.postMix.lines.find(l=>l.lineId===t.id),entry=frozen.audioManifest.sources.find(s=>s.id==='voice-'+t.id);if(!clock||!line||!entry||t.text!==line.recognizedText||t.verification!==line.status||t.audioSha256!==line.sourceSha256||t.startSample!==clock.startSample||t.endSample!==clock.endSample||!t.spokenTextEvidence||canonicalHash(t.spokenTextEvidence.sourceRef)!==canonicalHash(entry.sourceRef))throw Error('MVP_DIAGNOSTIC_SOURCE_CHANGED');const p=await loadPackagedNarration(store,root,projectId,bundle.revisionId,entry.sourceRef);if(t.spokenTextEvidence.expectedText!==p.source.expectedAsrText||t.spokenTextEvidence.policy!==p.words.recognitionPolicy)throw Error('MVP_DIAGNOSTIC_SOURCE_CHANGED')}
   const visualBatch=visual.batches.find(v=>v.round===1&&v.index===batch.index);if(!visualBatch)throw Error('MVP_DIAGNOSTIC_SOURCE_CHANGED');const e=await readNarrationJson(store,visualBatch.evidenceRef,approvalPrefix+'visual-frame-evidence/') as VisualEvidence;if(e.filmSha256!==c.filmSha256||e.runtimeDigest!==frozen.filmSpec.runtimeDigest||e.width!==frozen.filmSpec.output.width||e.height!==frozen.filmSpec.output.height||canonicalHash(e.frames.map(({id,frame,sha256,bytes})=>({id,frame,sha256,bytes})))!==canonicalHash(c.frames))throw Error('MVP_DIAGNOSTIC_SOURCE_CHANGED');for(const [id,data] of await readVisualEvidence(root,e))images.set(id,data);contexts.push(c);evidences.push(e);
  }
  if(!contexts.length||contexts.some(c=>canonicalHash(c.transcripts)!==canonicalHash(contexts[0].transcripts)))throw Error('MVP_DIAGNOSTIC_SOURCE_CHANGED');
  const {contextSha256,...raw}=contexts[0];void contextSha256;const context=contentReviewContext({...raw,frames:contexts.flatMap(c=>c.frames).sort((a,b)=>a.frame-b.frame),reviewBatch:{round:1,index:0},imageEncoding:'lossless_webp'});
  return{context,images,hash:canonicalHash({control,operation,approval,bundle,composition,visual,content,contexts,evidences})};
 }
 const original=await source(),id=randomUUID(),path='docs/engineering/evidence/mvp-complete-round-content-verified-transport.json',report:Record<string,unknown>={observedAt:new Date().toISOString(),status:'running',projectId,sourceOperationId:formal.operationId,diagnosticId:id,context:original.context,sourcePngBytes:original.context.frames.reduce((n,f)=>n+f.bytes,0),newMediaProducerCalls:0,productionApproval:false,resultPublished:false};
 await requireUnlimitedValidation(store);await claimProbeReport(path,report);
 const assertSource=async()=>{if((await source()).hash!==original.hash)throw Error('MVP_DIAGNOSTIC_SOURCE_CHANGED')},transport=recordModelRequests(process.env,root,1,{timeoutMs:600000});
 try{const reservation=await reserveModelBudget(store,projectId,'mvp-complete-round-diagnostic-'+id,{inputTokens:100000,outputTokens:8000},modelLimits(process.env));report.review=await runEffect(store,prefix+'diagnostics/'+id+'/effect',()=>withAccountedModel(store,reservation.reservation,()=>runContentCritic(original.context,original.images,reservation.maxOutputTokens,process.env,{assertActive:assertSource})));report.status='actual_complete_round_content_review_returned'}
 catch(error){report.status='failed';report.errorCode=(error as Error).message.split(':')[0].replaceAll(process.env.MODEL_API_KEY||'missing-key','[redacted]').slice(0,120);process.exitCode=1}
 finally{await transport.flush();transport.restore();report.requests=transport.requests;report.originalSourceUnchanged=(await source()).hash===original.hash;await persistProbeReport(path,report);console.log(JSON.stringify({status:report.status,errorCode:report.errorCode,requests:transport.requests.length,originalSourceUnchanged:report.originalSourceUnchanged,resultPublished:false}))}
}
main().catch(error=>{console.error((error as Error).message.replaceAll(process.env.MODEL_API_KEY||'missing-key','[redacted]').slice(0,120));process.exitCode=1});
