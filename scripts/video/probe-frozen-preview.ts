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
import {readNarrationJson} from '../../src/services/video/audio/narration-package';
import type {FilmPackageStageRecord} from '../../src/services/video/preview/film-package-stage';
import {probeEnvironment,recordModelRequests} from './helpers/real-probe';
import {claimProbeReport,persistProbeReport} from './helpers/probe-report';
async function main(){
 if(!process.argv.includes('--technical-preview-continuation'))throw Error('EXPLICIT_TECHNICAL_PREVIEW_REQUIRED');
 const book=process.argv.includes('--book-policy-preview-continuation');
 const original=JSON.parse(await readFile(book?'docs/engineering/evidence/new-theme-book-caption-preview-v2-probe.json':'docs/engineering/evidence/new-theme-accounted-audio-preview-probe.json','utf8'));
 const mix=JSON.parse(await readFile(book?'docs/engineering/evidence/book-preview-postmix-probe.json':'docs/engineering/evidence/accounted-preview-postmix-probe.json','utf8'));
 const review=JSON.parse(await readFile(book?'docs/engineering/evidence/book-preview-postmix-reviewed-probe.json':'docs/engineering/evidence/new-theme-postmix-trusted-review-probe.json','utf8'));
 const all=JSON.parse(await readFile(book?'docs/engineering/evidence/narration-reuse-policy-probe.json':'docs/engineering/evidence/reviewed-final-mix-recovery-probe.json','utf8')),source=original.stages.operation;
 const frozenFilm:import('../../src/services/video/audio/postmix-asr').PostMixFilm=book?mix.context.film:{outputPath:mix.filmPath,sha256:mix.filmSha256,durationMs:20000,technicalQa:'pass'};
 if(source.status!=='failed'||source.stage!=='composition')throw Error('FROZEN_FILM_REQUIRED');
 if(book){
  if(all.status!=='same_source_audio_verified_without_repeated_listening'||all.coldMatches!==true||all.sourceOperationId!==source.id||all.sourceRevisionId!==source.revisionId||all.filmSha256!==frozenFilm.sha256||mix.sourceOperationId!==source.id||review.sourceOperationId!==source.id||review.film.sha256!==frozenFilm.sha256||!review.reviewRef)throw Error('FROZEN_FILM_REQUIRED');
 }else if(all.status!=='full_postmix_verified'||all.filmSha256!==mix.filmSha256||review.filmSha256!==mix.filmSha256||review.sourceOperationId!==source.id)throw Error('FROZEN_FILM_REQUIRED');
 const {root}=original,projectId=source.projectId,store=new FileStore(root),projects=new ProjectStore(store),owner='new-theme-validation',prefix=`projects/${projectId}`,before=await projects.access(owner,projectId),old=(await store.readFresh(prefix+'/operations/'+source.id)).value;
 if(canonicalHash(old)!==canonicalHash(source))throw Error('SOURCE_OPERATION_CHANGED');
 const film=(await store.readFresh<FilmPackageStageRecord>(`${prefix}/revisions/${source.revisionId}/film-package-v2-stage`)).value;
 if(canonicalHash(film)!==canonicalHash(original.stages.stageRecords['film-package-v2-stage']))throw Error('FILM_PACKAGE_CHANGED');
 const spec=await readNarrationJson(store,film.filmSpecRef,`${prefix}/revisions/${source.revisionId}/film/`) as {treatmentRef:Parameters<typeof readNarrationJson>[1]},treatment=await readNarrationJson(store,spec.treatmentRef,`${prefix}/revisions/${source.revisionId}/treatment/`) as {planRef:Parameters<typeof readNarrationJson>[1]};
 const env:Environment={...probeEnvironment(root),VIDEO_MODEL_BUDGET_MODE:'unlimited_validation',VIDEO_MEDIA_TIMEOUT_SECONDS:'600',VIDEO_VOICE_IMAGE_REF:'sha256:b145374e774d91aa729569a65e06fe0038009398a55ae8d31e025b227642c8d6',VIDEO_VOICE_RUNTIME_DIGEST:'b145374e774d91aa729569a65e06fe0038009398a55ae8d31e025b227642c8d6',VIDEO_ASR_IMAGE_REF:'sha256:caa3fca3e3e6866dab7351346367768db612bb411f06fbd4a7a44f767747f5d4',VIDEO_ASR_RUNTIME_DIGEST:'caa3fca3e3e6866dab7351346367768db612bb411f06fbd4a7a44f767747f5d4',VIDEO_ASR_MODEL:'Systran/faster-whisper-medium'};
 if(book){env.VIDEO_MEDIA_IMAGE_REF='sha256:46a3a937735e1f0472fecc8e32b78da99c7da187aa1faac7017c523b92911dfb';env.VIDEO_MEDIA_RUNTIME_DIGEST='46a3a937735e1f0472fecc8e32b78da99c7da187aa1faac7017c523b92911dfb'}
 const recorder=recordModelRequests(env,root,8,{timeoutMs:600000}),path=book?(process.argv.includes('--book-policy-preview-continuation-v2')?'docs/engineering/evidence/book-frozen-preview-continuation-v2-probe.json':'docs/engineering/evidence/book-frozen-preview-continuation-probe.json'):'docs/engineering/evidence/frozen-preview-continuation-probe.json',report:{[key:string]:unknown}={executedAt:new Date().toISOString(),status:'started',root,projectId,sourceOperationId:source.id,sourceRevisionId:source.revisionId,filmSha256:frozenFilm.sha256,requests:recorder.requests,formalProductionApproval:false,deliveryEligible:false};
 await claimProbeReport(path,report);async function save(){await recorder.flush();report.budget=(await store.readFresh(prefix+'/budget')).value;await persistProbeReport(path,report)}
 try{
 const receipt=await preparePreview(projects,new LocalOperationQueue(store,root),owner,projectId,{schemaVersion:5,clientCommandId:randomUUID(),expectedBriefVersion:before.briefVersion},{root,frozenPreview:{sourceOperationId:source.id,treatmentRef:treatment.planRef,filmSpecRef:film.filmSpecRef,reviewRef:review.reviewRef,film:frozenFilm}});
 report.receipt=receipt;await save();
 await runPreviewOperation(store,new LocalEventLog(root),projectId,receipt.operationId,{root,env,build:async(...args)=>buildPreviewPipeline(args[0],args[1],args[2],async(stage,label)=>{await args[3](stage,label);report.currentStage=stage;await save();console.log(JSON.stringify({stage,requests:recorder.requests.length}))})});
 const operation=(await store.readFresh<PreviewOperation&{errorCode?:string}>(prefix+'/operations/'+receipt.operationId)).value;report.operation=operation;report.control=await projects.access(owner,projectId);report.status=operation.status==='succeeded'?'preview_published':'blocked';if(report.status==='blocked'){report.errorCode=operation.errorCode;process.exitCode=1}
 }catch(error){report.status='blocked';report.errorCode=String((error as Error).message).replaceAll(env.MODEL_API_KEY||'missing-key','[redacted]').slice(0,300);process.exitCode=1}
 finally{report.sourceOperationUnchanged=canonicalHash(old)===canonicalHash((await store.readFresh(prefix+'/operations/'+source.id)).value);await save();recorder.restore();console.log(JSON.stringify({status:report.status,errorCode:report.errorCode,requests:recorder.requests.length,currentStage:report.currentStage,sourceOperationUnchanged:report.sourceOperationUnchanged}))}
}
main().catch(error=>{console.error(JSON.stringify({status:'blocked',errorCode:String(error.message).replaceAll(process.env.MODEL_API_KEY||'missing-key','[redacted]').slice(0,300)}));process.exitCode=1});
