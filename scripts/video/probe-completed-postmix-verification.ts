import {readFile} from 'node:fs/promises';
import {FileStore} from '../../src/services/video/storage/file-store';
import {ProjectStore} from '../../src/services/video/storage/project-store';
import {canonicalHash} from '../../src/services/video/domain/hash';
import {persistPostMixVerification,loadPostMixVerification} from '../../src/services/video/audio/postmix-verification';
import {validateFrozenPreview} from '../../src/services/video/preview/frozen-preview';
import {loadVerifiedFilmPackage} from '../../src/contracts/video/film-package';
import {readNarrationJson} from '../../src/services/video/audio/narration-package';
import {claimProbeReport,persistProbeReport} from './helpers/probe-report';
async function main(){
 if(process.argv.slice(2).join(' ')!=='--freeze-completed-clear-postmix')throw Error('COMPLETED_POSTMIX_FLAG_REQUIRED');
 const evidence=JSON.parse(await readFile('docs/engineering/evidence/clear-book-stereo-average-probe.json','utf8'));
 if(evidence.status!=='actual_stereo_average_postmix_and_cold_verified'||evidence.coldMatches!==true||evidence.invocations.length!==8||evidence.invocations.some((r:{state:string})=>r.state!=='completed'))throw Error('COMPLETED_POSTMIX_EVIDENCE_REQUIRED');
 const {root,projectId,sourceOperationId}=evidence,store=new FileStore(root),projects=new ProjectStore(store),owner='new-theme-validation',prefix=`projects/${projectId}/`,journalOperationId=evidence.journalPrefix.split('/')[3];
 if(evidence.journalPrefix!==prefix+`operations/${journalOperationId}/media-effects`)throw Error('COMPLETED_POSTMIX_EVIDENCE_CHANGED');
 const controlKeys=[prefix+'control',prefix+'budget',prefix+'operations/'+sourceOperationId],before=await Promise.all(controlKeys.map(async key=>canonicalHash((await store.readFresh(key)).value))),nativeBefore=await Promise.all([evidence.journalPrefix,prefix+`operations/${sourceOperationId}/media-effects`].map(async prefix=>Promise.all((await store.listKeys(prefix,1)).map(async key=>({key,value:(await store.readFresh(key)).value})))));
 const input={sourceOperationId,filmSpecRef:evidence.filmSpecRef,film:{outputPath:root+'/composition/1356b6ba3641ef93e900eaf4fdee512e4ebdb6a029f3c29c366520d8b44e2554/output/final.mp4',sha256:evidence.technicalQa.sha256,durationMs:20000,technicalQa:'pass' as const}},path='docs/engineering/evidence/completed-clear-postmix-verification-probe.json',report:Record<string,unknown>={executedAt:new Date().toISOString(),status:'started',root,projectId,sourceOperationId,newModelCalls:0,newNativeCalls:0,formalProductionApproval:false,deliveryEligible:false};await claimProbeReport(path,report);
 try{
  const env={VIDEO_MEDIA_IMAGE_REF:'sha256:c91e4b1e1fe665b5017da982aed5a0f7b45fa11e2416207caa09304135d92623',VIDEO_MEDIA_RUNTIME_DIGEST:'c91e4b1e1fe665b5017da982aed5a0f7b45fa11e2416207caa09304135d92623',VIDEO_MEDIA_TIMEOUT_SECONDS:'600',VIDEO_ASR_IMAGE_REF:'sha256:caa3fca3e3e6866dab7351346367768db612bb411f06fbd4a7a44f767747f5d4',VIDEO_ASR_RUNTIME_DIGEST:'caa3fca3e3e6866dab7351346367768db612bb411f06fbd4a7a44f767747f5d4',VIDEO_ASR_MODEL:'Systran/faster-whisper-medium'};
  const ref=await persistPostMixVerification(projects,root,owner,projectId,input,journalOperationId,env);report.verificationRef=ref;await persistProbeReport(path,report);
  const verified=await loadPostMixVerification(new ProjectStore(new FileStore(root)),root,projectId,ref,input);report.verification=verified;
  const frozen=await loadVerifiedFilmPackage(store,await readNarrationJson(store,input.filmSpecRef,prefix+'revisions/'+evidence.sourceRevisionId+'/film/'),root),frozenInput={...input,treatmentRef:frozen.treatment.planRef,postMixVerificationRef:ref};
  const admitted=await validateFrozenPreview(projects,root,projectId,await projects.access(owner,projectId),frozenInput);report.frozenInput=frozenInput;report.admissionMatches=canonicalHash(admitted.input)===canonicalHash(frozenInput);
  try{await loadPostMixVerification(projects,root,projectId,ref,{...input,film:{...input.film,sha256:'f'.repeat(64)}});throw Error('CHANGED_FILM_ACCEPTED')}catch(error){if((error as Error).message==='CHANGED_FILM_ACCEPTED')throw error;report.changedFilmRejected=(error as Error).message}
  report.status='completed_postmix_frozen_admission_and_cold_verified';
 }catch(error){report.status='failed';report.errorCode=(error as Error).message;process.exitCode=1}
 finally{
  report.sourceControlBudgetOperationUnchanged=canonicalHash(before)===canonicalHash(await Promise.all(controlKeys.map(async key=>canonicalHash((await store.readFresh(key)).value))));report.nativeJournalsUnchanged=canonicalHash(nativeBefore)===canonicalHash(await Promise.all([evidence.journalPrefix,prefix+`operations/${sourceOperationId}/media-effects`].map(async prefix=>Promise.all((await store.listKeys(prefix,1)).map(async key=>({key,value:(await store.readFresh(key)).value}))))));if(!report.sourceControlBudgetOperationUnchanged||!report.nativeJournalsUnchanged){report.status='failed';report.errorCode='COMPLETED_POSTMIX_SOURCE_CHANGED';process.exitCode=1}await persistProbeReport(path,report);console.log(JSON.stringify({status:report.status,errorCode:report.errorCode}));
 }
}
main().catch(error=>{console.error(error.message);process.exitCode=1});
