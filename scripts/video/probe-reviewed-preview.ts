import {claimProbeReport,persistProbeReport} from './helpers/probe-report';
import type {Environment} from '../../src/services/video/config/environment';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {FileStore} from '../../src/services/video/storage/file-store';
import {ProjectStore} from '../../src/services/video/storage/project-store';
import {LocalOperationQueue} from '../../src/services/video/commands/local-queue';
import {LocalEventLog} from '../../src/services/video/stream/local-event-log';
import {runPreviewOperation} from '../../src/services/video/commands/local-preview';
import {preparePreview,type PreviewOperation} from '../../src/services/video/preview/prepare';
import {buildPreviewPipeline} from '../../src/services/video/preview/pipeline';
import {canonicalHash,canonicalJson} from '../../src/services/video/domain/hash';
import {probeEnvironment,recordModelRequests} from './helpers/real-probe';

const clearBookPreview=process.argv.includes('--clear-book-caption-preview'),bookPreviewV2=process.argv.includes('--book-caption-preview-v2'),bookPreview=clearBookPreview||bookPreviewV2||process.argv.includes('--book-caption-preview'),accountedPreview=process.argv.includes('--accounted-audio-preview'),resetPreview=process.argv.includes('--canvas-reset-preview'),evidencePath=clearBookPreview?'docs/engineering/evidence/new-theme-clear-book-caption-preview-probe.json':bookPreviewV2?'docs/engineering/evidence/new-theme-book-caption-preview-v2-probe.json':bookPreview?'docs/engineering/evidence/new-theme-book-caption-preview-probe.json':accountedPreview?'docs/engineering/evidence/new-theme-accounted-audio-preview-probe.json':resetPreview?'docs/engineering/evidence/new-theme-canvas-reset-preview-probe.json':'docs/engineering/evidence/new-theme-reviewed-preview-probe.json';
async function main(){
 if(!bookPreview&&!accountedPreview&&!resetPreview&&!process.argv.includes('--reviewed-preview'))throw Error('EXPLICIT_PROBE_REQUIRED');
 try{await readFile(evidencePath);throw Error('PROBE_ALREADY_RECORDED_NO_AUTOMATIC_RETRY')}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error}
 const source=JSON.parse(await readFile('docs/engineering/evidence/new-theme-upgraded-probe.json','utf8')),review=JSON.parse(await readFile('docs/engineering/evidence/new-theme-trusted-review-probe.json','utf8')),speech=JSON.parse(await readFile('docs/engineering/evidence/new-theme-reviewed-narration-v2-probe.json','utf8')),answer=JSON.parse(await readFile('docs/engineering/evidence/new-theme-spoken-review-confirmation.json','utf8'));
 if(speech.status!=='source_narration_verified'||review.status!=='trusted_review'||review.projectId!==source.projectId||speech.projectId!==source.projectId||review.planSha256!==speech.planSha256)throw Error('REVIEWED_SOURCE_REQUIRED');
 const {root,projectId}=source,store=new FileStore(root),projects=new ProjectStore(store),owner='new-theme-validation',prefix=`projects/${projectId}`,before=await projects.access(owner,projectId),oldKey=prefix+'/operations/'+review.sourceOperationId,oldOperation=(await store.readFresh(oldKey)).value;
 if(canonicalHash(oldOperation)!==canonicalHash(source.stages.operation))throw Error('SOURCE_OPERATION_CHANGED');
 const treatmentKeys=await store.listKeys(prefix+'/revisions/'+answer.sourceRevisionId+'/treatment-plan',1);if(treatmentKeys.length!==1)throw Error('TREATMENT_CHANGED');
 const oldTreatment=(await store.readFresh(treatmentKeys[0])).value;
 const oldTreatmentRef={key:treatmentKeys[0],sha256:canonicalHash(oldTreatment),bytes:Buffer.byteLength(canonicalJson(oldTreatment)),mime:'application/json'};
 if(!oldTreatmentRef.key.endsWith('/'+oldTreatmentRef.sha256))throw Error('TREATMENT_CHANGED');
 const messages=await projects.messages(before),sourceMessage=messages.find(item=>item.role==='user'&&item.id!==review.confirmationMessageId&&item.status==='completed');if(!sourceMessage)throw Error('SOURCE_MESSAGE_REQUIRED');
 const env:Environment={...probeEnvironment(root),VIDEO_MODEL_BUDGET_MODE:'unlimited_validation',VIDEO_MEDIA_TIMEOUT_SECONDS:'600',VIDEO_VOICE_IMAGE_REF:'sha256:'+answer.voiceRuntimeDigest,VIDEO_VOICE_RUNTIME_DIGEST:answer.voiceRuntimeDigest,VIDEO_ASR_IMAGE_REF:'sha256:'+answer.asrRuntimeDigest,VIDEO_ASR_RUNTIME_DIGEST:answer.asrRuntimeDigest,VIDEO_ASR_MODEL:'Systran/faster-whisper-medium'};
 if(bookPreview){const image=(await readFile(clearBookPreview?'.video-local/font-builds/longcang-406197b9/image.id':'.video-local/font-builds/locked-406197b9-local-base/image.id','utf8')).trim(),expected=clearBookPreview?'sha256:c91e4b1e1fe665b5017da982aed5a0f7b45fa11e2416207caa09304135d92623':'sha256:46a3a937735e1f0472fecc8e32b78da99c7da187aa1faac7017c523b92911dfb';if(image!==expected)throw Error('BOOK_PREVIEW_IMAGE_CHANGED');env.VIDEO_MEDIA_IMAGE_REF=image;env.VIDEO_MEDIA_RUNTIME_DIGEST=image.slice(7)}
 const recorder=recordModelRequests(env,root,64,{timeoutMs:600000}),evidence:{executedAt:string;root:string;projectId:string;sourceOperationId:string;status:string;requests:typeof recorder.requests;stages:Record<string,unknown>;errorCode?:string;limits:string}={executedAt:new Date().toISOString(),root,projectId,sourceOperationId:review.sourceOperationId,status:'started',requests:recorder.requests,stages:{sourceTreatmentRef:oldTreatmentRef,sourceBudget:(await store.readFresh(prefix+'/budget')).value},limits:'New authorized preview operation and revision (current Visual instructions require full Canvas state reset and leave narration captions to the compositor) after explicit single-WAV listening confirmation. Reuses only the original completed frozen Treatment effect. Existing failed operation and unknown histories remain unchanged. Actual downstream Audio/Visual/Critic calls and media are allowed; no formal production approval or final quality claim.'};
 async function record(){await recorder.flush();evidence.stages.budget=(await store.readFresh(prefix+'/budget')).value;await persistProbeReport(evidencePath,evidence)}
 await claimProbeReport(evidencePath,evidence);
 try{
  await record();
  const receipt=await preparePreview(projects,new LocalOperationQueue(store,root),owner,projectId,{schemaVersion:5,clientCommandId:randomUUID(),expectedBriefVersion:before.briefVersion,sourceMessageId:sourceMessage.id},{reviewedTreatment:{sourceOperationId:review.sourceOperationId,treatmentRef:oldTreatmentRef,reviewRef:review.reviewRef}});
  evidence.stages.receipt=receipt;await record();
  await runPreviewOperation(store,new LocalEventLog(root),projectId,receipt.operationId,{root,env,build:async(...args)=>{
   const notify=args[3];return buildPreviewPipeline(args[0],args[1],args[2],async(stage,label)=>{await notify(stage,label);evidence.stages.currentStage=stage;await record();console.log(JSON.stringify({stage,status:'running',requests:recorder.requests.length}))});
  }});
  const operation=(await store.readFresh<PreviewOperation&{errorCode?:string}>(prefix+'/operations/'+receipt.operationId)).value;
  evidence.stages.operation=operation;evidence.stages.control=await projects.access(owner,projectId);
  const keys=await store.listKeys(prefix+'/revisions/'+operation.revisionId,1);
  const stages:Record<string,unknown>={};for(const key of keys)if(key.endsWith('-stage'))stages[key.split('/').at(-1)!]=(await store.readFresh(key)).value;evidence.stages.stageRecords=stages;
  evidence.status=operation.status==='succeeded'?'preview_published':'blocked';if(evidence.status==='blocked'){evidence.errorCode=operation.errorCode||'PREVIEW_NOT_SUCCEEDED';process.exitCode=1}
 }catch(error){evidence.status='blocked';evidence.errorCode=String((error as Error).message).replaceAll(env.MODEL_API_KEY||'missing-key','[redacted]').slice(0,300);process.exitCode=1}
 finally{
  evidence.stages.sourceOperationUnchanged=canonicalHash((await store.readFresh(oldKey)).value)===canonicalHash(oldOperation);
  evidence.stages.sourceTreatmentUnchanged=canonicalHash((await store.readFresh(oldTreatmentRef.key)).value)===oldTreatmentRef.sha256;
  await record();recorder.restore();console.log(JSON.stringify({status:evidence.status,errorCode:evidence.errorCode,requests:recorder.requests.length,currentStage:evidence.stages.currentStage}));
 }
}
main().catch(error=>{console.error(JSON.stringify({status:'failed',errorCode:String(error.message).replaceAll(process.env.MODEL_API_KEY||'missing-key','[redacted]').slice(0,300)}));process.exitCode=1});
