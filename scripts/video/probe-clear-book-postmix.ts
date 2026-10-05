import {randomUUID,createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {FileStore} from '../../src/services/video/storage/file-store';
import {ProjectStore} from '../../src/services/video/storage/project-store';
import {canonicalHash} from '../../src/services/video/domain/hash';
import {readNarrationJson} from '../../src/services/video/audio/narration-package';
import {loadVerifiedFilmPackage} from '../../src/contracts/video/film-package';
import {technicalVideoQa} from '../../src/services/video/media/technical-qa';
import {measureFinalLoudness} from '../../src/services/video/audio/loudness';
import {verifyPostMixNarration} from '../../src/services/video/audio/postmix-asr';
import {postMixExtractionKey} from '../../src/services/video/audio/postmix-extraction';
import {resolvePreviewPostMixReview} from '../../src/services/video/preview/postmix-review';
import {inspectVoiceWav} from '../../src/services/video/audio/wav';
import type {NarrationPlan} from '../../src/services/video/audio/narration';
import type {VerifiedNarrationManifest} from '../../src/services/video/audio/asr';
import {claimProbeReport,persistProbeReport} from './helpers/probe-report';
async function main(){
 if(process.argv.slice(2).join(' ')!=='--verify-clear-book-stereo-average')throw Error('CLEAR_BOOK_POSTMIX_FLAG_REQUIRED');
 const source=JSON.parse(await readFile('docs/engineering/evidence/new-theme-clear-book-caption-preview-probe.json','utf8')),op=source.stages.operation,{root,projectId}=source,store=new FileStore(root),projects=new ProjectStore(store),prefix=`projects/${projectId}/`,revisionPrefix=prefix+`revisions/${op.revisionId}/`;
 if(source.status!=='blocked'||op.status!=='failed'||op.stage!=='composition'||source.requests.length!==5||canonicalHash((await store.readFresh(prefix+'operations/'+op.id)).value)!==canonicalHash(op))throw Error('CLEAR_BOOK_POSTMIX_SOURCE_CHANGED');
 const controlKeys=[prefix+'control',prefix+'budget',prefix+'operations/'+op.id],before=await Promise.all(controlKeys.map(async key=>canonicalHash((await store.readFresh(key)).value))),sourceJournal=prefix+`operations/${op.id}/media-effects`,oldJournal=await store.listKeys(sourceJournal,1);
 const digest='c91e4b1e1fe665b5017da982aed5a0f7b45fa11e2416207caa09304135d92623',asr='caa3fca3e3e6866dab7351346367768db612bb411f06fbd4a7a44f767747f5d4',env={VIDEO_MEDIA_IMAGE_REF:'sha256:'+digest,VIDEO_MEDIA_RUNTIME_DIGEST:digest,VIDEO_MEDIA_TIMEOUT_SECONDS:'600',VIDEO_ASR_IMAGE_REF:'sha256:'+asr,VIDEO_ASR_RUNTIME_DIGEST:asr,VIDEO_ASR_MODEL:'Systran/faster-whisper-medium'},stageDir=join(root,'composition','1356b6ba3641ef93e900eaf4fdee512e4ebdb6a029f3c29c366520d8b44e2554'),expectedSha='ceaa9448c41fd7dd54e3cea4686f716524d9285c9e5cc4212a199bb6c3c5b552',journal={store,prefix:prefix+`operations/${randomUUID()}/media-effects`},path='docs/engineering/evidence/clear-book-stereo-average-probe.json';
 const report:Record<string,unknown>={executedAt:new Date().toISOString(),status:'started',root,projectId,sourceOperationId:op.id,sourceRevisionId:op.revisionId,journalPrefix:journal.prefix,newModelCalls:0,formalProductionApproval:false,deliveryEligible:false};await claimProbeReport(path,report);
 try{
  const record=source.stages.stageRecords['film-package-v2-stage'];if(canonicalHash((await store.readFresh(revisionPrefix+'film-package-v2-stage')).value)!==canonicalHash(record))throw Error('CLEAR_BOOK_POSTMIX_SOURCE_CHANGED');
  const frozen=await loadVerifiedFilmPackage(store,await readNarrationJson(store,record.filmSpecRef,revisionPrefix+'film/'),root);
  if(frozen.filmSpec.qualityPolicyVersion!=='v5.1-package-4-clear-book-captions'||frozen.filmSpec.runtimeDigest!==digest)throw Error('CLEAR_BOOK_POSTMIX_SOURCE_CHANGED');
  const qa=await technicalVideoQa(stageDir,'sha256:'+digest,'output/final.mp4',{width:1280,height:720,durationSec:20,fps:24,audio:true,audioChannels:2});
  if(qa.sha256!==expectedSha||qa.bytes!==5339754)throw Error('CLEAR_BOOK_POSTMIX_SOURCE_CHANGED');
  const film={outputPath:join(stageDir,'output/final.mp4'),sha256:qa.sha256,durationMs:20000,technicalQa:'pass' as const},loudness=await measureFinalLoudness(root,film,false,env);if(loudness.status!=='pass')throw Error('CLEAR_BOOK_LOUDNESS_FAILED');
  const voice=source.stages.stageRecords['voice-stage'],plan=await readNarrationJson(store,voice.planRef,revisionPrefix+'voice-plan/') as NarrationPlan,verified=await readNarrationJson(store,voice.verifiedRef,revisionPrefix+'voice-verified/') as VerifiedNarrationManifest,resolveReview=(context:Parameters<typeof resolvePreviewPostMixReview>[4])=>resolvePreviewPostMixReview(projects,root,projectId,op.revisionId,context,{mustExist:true,verified});
  const result=await verifyPostMixNarration(root,film,plan,verified,env,undefined,{journal,downmix:'stereo_average',resolveReview});report.result=result;report.technicalQa=qa;report.loudness=loudness;report.filmSpecRef=record.filmSpecRef;await persistProbeReport(path,report);
  const outputs=[];for(const [i,line] of verified.lines.entries()){
   const lengthMs=Math.min(line.durationMs+300,(verified.lines[i+1]?.startMs??20000)-line.startMs,20000-line.startMs),window={startMs:line.startMs,lengthMs,mediaRuntimeDigest:digest,downmix:'stereo_average' as const},key=postMixExtractionKey(qa.sha256,line.lineId,line.language,window),wav=await inspectVoiceWav(join(root,'postmix',key,'output/line.wav'));outputs.push({lineId:line.lineId,key,wav});
  }
  const keys=await store.listKeys(journal.prefix,1),cold=await verifyPostMixNarration(root,film,plan,verified,env,undefined,{journal,mustExist:true,downmix:'stereo_average',resolveReview});
  if(canonicalHash(cold)!==canonicalHash(result)||canonicalHash(keys)!==canonicalHash(await store.listKeys(journal.prefix,1)))throw Error('CLEAR_BOOK_POSTMIX_COLD_CHANGED');
  const oldPath=join(root,'postmix','7f373c4b6d0a4663939e723e60f8c853a5bedf59ddaef4a8e193f8a1ddaa09e1','output/line.wav');
  if(createHash('sha256').update(await readFile(oldPath)).digest('hex')!=='5234f3fde2fd485f8f65ba52c3dfbc5a00e1879c09568ebf74ab54465686a13f')throw Error('CLEAR_BOOK_OLD_DOWNMIX_CHANGED');
  report.outputs=outputs;report.coldMatches=true;report.newColdNativeCalls=0;report.oldInvalidWavPreserved=true;report.status='actual_stereo_average_postmix_and_cold_verified';
 }catch(error){report.status='failed';report.errorCode=(error as Error).message;process.exitCode=1}
 finally{
  report.sourceControlBudgetOperationUnchanged=canonicalHash(before)===canonicalHash(await Promise.all(controlKeys.map(async key=>canonicalHash((await store.readFresh(key)).value))));report.originalNativeJournalUnchanged=canonicalHash(oldJournal)===canonicalHash(await store.listKeys(sourceJournal,1));report.invocations=await Promise.all((await store.listKeys(journal.prefix,1)).map(async key=>(await store.readFresh(key)).value));if(!report.sourceControlBudgetOperationUnchanged||!report.originalNativeJournalUnchanged){report.status='failed';report.errorCode='CLEAR_BOOK_SOURCE_CHANGED';process.exitCode=1}await persistProbeReport(path,report);console.log(JSON.stringify({status:report.status,errorCode:report.errorCode,newModelCalls:0}));
 }
}
main().catch(error=>{console.error(error.message);process.exitCode=1});
