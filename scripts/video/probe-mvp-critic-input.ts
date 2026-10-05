import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {ProjectStore} from '../../src/services/video/storage/project-store';
import {readPreviewBundle} from '../../src/services/video/preview/commit';
import {verifyPreviewPackage} from '../../src/services/video/preview/package';
import {readNarrationJson} from '../../src/services/video/audio/narration-package';
import type {ObjectRef} from '../../src/contracts/video/domain';
import type {ApprovalRecord} from '../../src/services/video/preview/approve';
import {frozenVisualCriteria} from '../../src/services/video/quality/source-visual-criteria';
import {getStyle} from '../../src/services/video/styles/registry';
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
 const mode=process.argv.slice(2).join(' ');if(!['--diagnose-two-real-frames','--verify-source-only'].includes(mode))throw Error('MVP_DIAGNOSTIC_OPT_IN_REQUIRED');
 const candidateRoot=process.env.VIDEO_DATA_DIR;if(!candidateRoot)throw Error('CONFIGURATION_REQUIRED');const root:string=candidateRoot;
 const closure=JSON.parse(await readFile('docs/engineering/evidence/mvp-browser-closure.json','utf8')),projectId=closure.projectId,formal=closure.smallBatchFormal,store=new FileStore(root),prefix=`projects/${projectId}/`,operationKey=prefix+'operations/'+formal.operationId;
 const approvalPrefix=prefix+'approvals/'+formal.approvalId+'/';
 async function readSource(){
  const operation=(await store.readFresh<{id:string;projectId:string;status:string;kind:string;approvalId:string;bundleHash:string}>(operationKey)).value;
  const approval=(await store.readFresh<ApprovalRecord>(prefix+'approvals/'+formal.approvalId)).value;
  if(operation.status!=='failed'||operation.kind!=='render'||operation.id!==formal.operationId||operation.projectId!==projectId||operation.approvalId!==formal.approvalId||approval.projectId!==projectId||approval.approvalId!==formal.approvalId||approval.source!=='preview_button'||operation.bundleHash!==approval.bundleHash)throw Error('MVP_DIAGNOSTIC_FAILED_SOURCE_REQUIRED');
  const projects=new ProjectStore(store),bundle=await readPreviewBundle(projects,projectId,approval.previewId,root),frozen=await verifyPreviewPackage(projects,projectId,bundle,root);
  if(approval.bundleHash!==bundle.bundleHash||approval.revisionId!==bundle.revisionId||approval.scriptHash!==bundle.scriptHash||approval.factsHash!==bundle.factsHash||approval.briefVersion!==bundle.briefVersion)throw Error('MVP_DIAGNOSTIC_SOURCE_CHANGED');
  const composition=(await store.readFresh<{inputHash:string;movie:{technicalQa:{sha256:string}}}>(approvalPrefix+'composite-v2-stage')).value;
  const stage=(await store.readFresh<{inputHash:string;compositionHash:string;batches:Array<{round:1|2;contextRef:ObjectRef;evidenceRef:ObjectRef}>}>(approvalPrefix+'visual-evidence-v1-stage')).value;
  if(stage.compositionHash!==canonicalHash(composition)||stage.inputHash!==composition.inputHash)throw Error('MVP_DIAGNOSTIC_SOURCE_CHANGED');
  const batch=stage.batches[0],fullContext=await readNarrationJson(store,batch.contextRef,approvalPrefix+'visual-context/') as VisualReviewContext,evidence=await readNarrationJson(store,batch.evidenceRef,approvalPrefix+'visual-frame-evidence/') as VisualEvidence;
  const {frameSetSha256,...raw}=fullContext,verified=visualReviewContext(raw),film=frozen.filmSpec;
  const expected=visualReviewContext({filmSha256:composition.movie.technicalQa.sha256,filmSpecSha256:bundle.filmSpecRef.sha256,styleSlug:film.style.slug,styleRulesHash:getStyle(film.style.slug).rulesHash,round:batch.round,frames:evidence.frames.map(({id,frame,sha256,bytes})=>({id,frame,sha256,bytes})),facts:frozen.facts.facts.filter(f=>f.critical||f.mustInclude).map(({id,text})=>({id,text})),...(frozenVisualCriteria(frozen)?{sourceCriteria:frozenVisualCriteria(frozen)}:{})});
  if(frameSetSha256!==verified.frameSetSha256||canonicalHash(verified)!==canonicalHash(expected)||evidence.filmSha256!==expected.filmSha256||evidence.runtimeDigest!==film.runtimeDigest||evidence.width!==film.output.width||evidence.height!==film.output.height)throw Error('MVP_DIAGNOSTIC_SOURCE_CHANGED');
  const images=await readVisualEvidence(root,evidence);
  return{fullContext,images,hash:canonicalHash({operation,approval,bundle,composition,stage,fullContext,evidence})};
 }
 const source=await readSource();if(mode==='--verify-source-only'){console.log(JSON.stringify({sourceVerified:true,sourceHash:source.hash,newModelCalls:0,newNativeCalls:0,resultPublished:false}));return}const control=(await store.readFresh(prefix+'control')).value,sourceHash=canonicalHash(control),{frameSetSha256,...raw}=source.fullContext;void frameSetSha256;
 const context=visualReviewContext({...raw,frames:raw.frames.slice(0,2)}),images=new Map(context.frames.map(f=>[f.id,source.images.get(f.id)!])),id=randomUUID(),path='docs/engineering/evidence/mvp-two-frame-critic-diagnostic.json',report:Record<string,unknown>={observedAt:new Date().toISOString(),status:'running',sourceOperationId:formal.operationId,projectId,diagnosticId:id,context,frameBytes:context.frames.reduce((n,f)=>n+f.bytes,0),newNativeCalls:0,productionApproval:false,resultPublished:false};
 await requireUnlimitedValidation(store);await claimProbeReport(path,report);
 async function assertSource(){if(canonicalHash((await store.readFresh(prefix+'control')).value)!==sourceHash||(await readSource()).hash!==source.hash)throw Error('MVP_DIAGNOSTIC_SOURCE_CHANGED')}
 const transport=recordModelRequests(process.env,root,1,{timeoutMs:600000});
 try{
  const reservation=await reserveModelBudget(store,projectId,'mvp-two-frame-diagnostic-'+id,{inputTokens:100000,outputTokens:8000},modelLimits(process.env));
  const review=await runEffect(store,prefix+'diagnostics/'+id+'/effect',()=>withAccountedModel(store,reservation.reservation,()=>runVisualCritic(context,images,reservation.maxOutputTokens,process.env,{assertActive:assertSource})));
  report.review=review;report.status='actual_two_frame_review_returned';
 }catch(error){report.status='failed';report.errorCode=(error as Error).message.split(':')[0].replaceAll(process.env.MODEL_API_KEY||'missing-key','[redacted]').slice(0,120);process.exitCode=1}
 finally{await transport.flush();transport.restore();report.requests=transport.requests;report.originalControlAndFailedOperationUnchanged=canonicalHash((await store.readFresh(prefix+'control')).value)===sourceHash&&(await readSource()).hash===source.hash;await persistProbeReport(path,report);console.log(JSON.stringify({status:report.status,errorCode:report.errorCode,requests:transport.requests.length,originalControlAndFailedOperationUnchanged:report.originalControlAndFailedOperationUnchanged,resultPublished:false}))}
}
main().catch(error=>{console.error((error as Error).message.replaceAll(process.env.MODEL_API_KEY||'missing-key','[redacted]').slice(0,120));process.exitCode=1});
