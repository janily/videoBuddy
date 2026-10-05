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
import {canonicalHash} from '../../src/services/video/domain/hash';
import {probeEnvironment,recordModelRequests} from './helpers/real-probe';
import {claimProbeReport,persistProbeReport} from './helpers/probe-report';
async function main(){
 if(process.argv.slice(2).join(' ')!=='--continue-completed-clear-film')throw Error('CLEAR_FILM_CONTINUATION_FLAG_REQUIRED');
 const proof=JSON.parse(await readFile('docs/engineering/evidence/completed-clear-postmix-verification-probe.json','utf8'));
 if(proof.status!=='completed_postmix_frozen_admission_and_cold_verified'||proof.admissionMatches!==true||proof.sourceControlBudgetOperationUnchanged!==true||proof.nativeJournalsUnchanged!==true)throw Error('CLEAR_FILM_VERIFICATION_REQUIRED');
 const {root,projectId,sourceOperationId,frozenInput}=proof,store=new FileStore(root),projects=new ProjectStore(store),owner='new-theme-validation',prefix=`projects/${projectId}/`,before=await projects.access(owner,projectId),original=(await store.readFresh(prefix+'operations/'+sourceOperationId)).value;
 const env:Environment={...probeEnvironment(root),VIDEO_MODEL_BUDGET_MODE:'unlimited_validation',VIDEO_MEDIA_TIMEOUT_SECONDS:'600',VIDEO_MEDIA_IMAGE_REF:'sha256:c91e4b1e1fe665b5017da982aed5a0f7b45fa11e2416207caa09304135d92623',VIDEO_MEDIA_RUNTIME_DIGEST:'c91e4b1e1fe665b5017da982aed5a0f7b45fa11e2416207caa09304135d92623',VIDEO_VOICE_IMAGE_REF:'sha256:b145374e774d91aa729569a65e06fe0038009398a55ae8d31e025b227642c8d6',VIDEO_VOICE_RUNTIME_DIGEST:'b145374e774d91aa729569a65e06fe0038009398a55ae8d31e025b227642c8d6',VIDEO_ASR_IMAGE_REF:'sha256:caa3fca3e3e6866dab7351346367768db612bb411f06fbd4a7a44f767747f5d4',VIDEO_ASR_RUNTIME_DIGEST:'caa3fca3e3e6866dab7351346367768db612bb411f06fbd4a7a44f767747f5d4',VIDEO_ASR_MODEL:'Systran/faster-whisper-medium'};
 const recorder=recordModelRequests(env,root,8,{timeoutMs:600000}),path='docs/engineering/evidence/clear-frozen-preview-continuation-probe.json',report:Record<string,unknown>={executedAt:new Date().toISOString(),status:'started',root,projectId,sourceOperationId,sourceRevisionId:proof.verification.sourceRevisionId,filmSha256:frozenInput.film.sha256,verificationRef:proof.verificationRef,requests:recorder.requests,formalProductionApproval:false,deliveryEligible:false};await claimProbeReport(path,report);
 async function save(){await recorder.flush();report.budget=(await store.readFresh(prefix+'budget')).value;await persistProbeReport(path,report)}
 try{
  const receipt=await preparePreview(projects,new LocalOperationQueue(store,root),owner,projectId,{schemaVersion:5,clientCommandId:randomUUID(),expectedBriefVersion:before.briefVersion},{root,frozenPreview:frozenInput});report.receipt=receipt;await save();
  await runPreviewOperation(store,new LocalEventLog(root),projectId,receipt.operationId,{root,env,build:async(...args)=>buildPreviewPipeline(args[0],args[1],args[2],async(stage,label)=>{await args[3](stage,label);report.currentStage=stage;await save();console.log(JSON.stringify({stage,requests:recorder.requests.length}))})});
  const operation=(await store.readFresh<PreviewOperation&{errorCode?:string}>(prefix+'operations/'+receipt.operationId)).value;report.operation=operation;report.control=await projects.access(owner,projectId);report.status=operation.status==='succeeded'?'preview_published':'blocked';if(report.status==='blocked'){report.errorCode=operation.errorCode;process.exitCode=1}
 }catch(error){report.status='blocked';report.errorCode=(error as Error).message.replaceAll(env.MODEL_API_KEY||'missing-key','[redacted]').slice(0,300);process.exitCode=1}
 finally{report.sourceOperationUnchanged=canonicalHash(original)===canonicalHash((await store.readFresh(prefix+'operations/'+sourceOperationId)).value);await save();recorder.restore();console.log(JSON.stringify({status:report.status,errorCode:report.errorCode,requests:recorder.requests.length,currentStage:report.currentStage,sourceOperationUnchanged:report.sourceOperationUnchanged}))}
}
main().catch(error=>{console.error(String(error.message).replaceAll(process.env.MODEL_API_KEY||'missing-key','[redacted]').slice(0,300));process.exitCode=1});
