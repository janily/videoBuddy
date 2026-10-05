import {randomUUID} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {FileStore} from '../../src/services/video/storage/file-store';
import {canonicalHash} from '../../src/services/video/domain/hash';
import {readNarrationJson} from '../../src/services/video/audio/narration-package';
import {loadAudioExecution} from '../../src/services/video/audio/execution-package';
import {buildAudioMaster} from '../../src/services/video/audio/master';
import {inspectTrackWav,inspectStereoTrackWav} from '../../src/services/video/audio/wav';
import {runOwnedDocker} from '../../src/services/video/media/owned-docker';
import {technicalVideoQa} from '../../src/services/video/media/technical-qa';
import {verifyPostMixNarration} from '../../src/services/video/audio/postmix-asr';
import {AudioPlanSchema} from '../../src/contracts/video/audio-plan';
import {TimingDraftSchema} from '../../src/services/video/preview/timing-draft';
import type {NarrationPlan} from '../../src/services/video/audio/narration';
import type {VerifiedNarrationManifest} from '../../src/services/video/audio/asr';

async function main(){
 if(process.argv[2]!=='--verify-quieter-real-mix')throw Error('EXPLICIT_DIAGNOSTIC_REQUIRED');
 const root=resolve('.video-local/clear-full-critic-UGy32l'),projectId='0c5e1563-7bf4-4fbd-b876-ecec6c8634f8',revisionId='dd3020f4-d222-4f52-893b-00e938e00830',store=new FileStore(root),prefix=`projects/${projectId}`,rev=`${prefix}/revisions/${revisionId}`,op=randomUUID(),journal={store,prefix:`${prefix}/operations/${op}/media-effects`},reportPath='docs/engineering/evidence/mvp-voice-first-real-mix.json';
 const keys=[prefix+'/control',prefix+'/budget',prefix+'/operations/b3f64960-2d28-48c9-a514-749e5bfe0017'],before=await Promise.all(keys.map(async key=>canonicalHash((await store.readFresh(key)).value)));
 const report:Record<string,unknown>={startedAt:new Date().toISOString(),status:'started',projectId,revisionId,diagnosticOperationId:op,newModelCalls:0,deliveryEligible:false,limits:'Real archived voice, music, foley and picture. A new diagnostic mix and AAC only; does not publish a preview or approve production.'};
 await writeFile(reportPath,JSON.stringify(report,null,2)+'\n',{flag:'wx'});
 globalThis.fetch=async()=>{throw Error('MODEL_NETWORK_FORBIDDEN')};
 try{
 const exec=(await store.readFresh<{packageRef:Parameters<typeof loadAudioExecution>[4]}>(rev+'/audio-execution-v2-stage')).value;
 const timingRecord=(await store.readFresh<{draftRef:Parameters<typeof loadAudioExecution>[4]}>(rev+'/timing-stage')).value;
 const planRecord=(await store.readFresh<{planRef:Parameters<typeof loadAudioExecution>[4]}>(rev+'/audio-plan-stage')).value;
 const voiceRecord=(await store.readFresh<{planRef:Parameters<typeof loadAudioExecution>[4];verifiedRef:Parameters<typeof loadAudioExecution>[4]}>(rev+'/voice-stage')).value;
 const loaded=await loadAudioExecution(store,root,projectId,revisionId,exec.packageRef,planRecord.planRef,timingRecord.draftRef),data=loaded.package;
 const plan=AudioPlanSchema.parse(await readNarrationJson(store,planRecord.planRef,rev+'/audio-plan/')),timing=TimingDraftSchema.parse(await readNarrationJson(store,timingRecord.draftRef,rev+'/timing-draft/'));
 const voice={outputPath:timing.track.outputPath,runtimeDigest:data.runtimeDigest,wav:await inspectTrackWav(timing.track.outputPath,data.totalSamples,false),kind:'narration_only' as const,qaStatus:'not_checked' as const};
 const music=join(root,'sound',data.sound.stageKey,'output/music.wav'),foley=join(root,'sound',data.sound.stageKey,'output/foley.wav');
 const stems={...data.sound,runtimeDigest:data.runtimeDigest,music:{outputPath:music,wav:await inspectStereoTrackWav(music,data.totalSamples,false)},foley:{outputPath:foley,wav:await inspectStereoTrackWav(foley,data.totalSamples,false)},qualityStatus:'listening_not_checked' as const};
 const env=process.env,result=await buildAudioMaster(root,plan,voice,stems,data.durationMs,data.fps,env,{speechPriority:'voice-first-v1',journal});report.master=result;
 const source=join(root,'composition/6fb31b252ebbe776b7310c20b75e92f396c164ff1d48402ce424c75b2a48173b/output/final.mp4'),stageDir=join(root,'composition','mvp-voice-first-'+op),outputDir=join(stageDir,'output');await mkdir(outputDir,{recursive:true,mode:0o700});
 const image='sha256:'+data.runtimeDigest,args=['run','--rm','--network','none','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges','--pids-limit','64','--cpus','2','--memory','1g','--tmpfs','/tmp:rw,nosuid,size=64m','--mount',`type=bind,src=${source},dst=/input/source.mp4,readonly`,'--mount',`type=bind,src=${result.track.outputPath},dst=/input/mix.wav,readonly`,'--mount',`type=bind,src=${outputDir},dst=/output`,image,'ffmpeg','-nostdin','-hide_banner','-loglevel','error','-xerror','-i','/input/source.mp4','-i','/input/mix.wav','-map','0:v:0','-map','1:a:0','-c:v','copy','-af','acompressor=threshold=0.08:ratio=4:attack=2:release=100:detection=peak,loudnorm=I=-14:TP=-1.5:LRA=11','-c:a','aac','-b:a','192k','-ar','48000','-ac','2','-movflags','+faststart','/output/final.mp4'];
 await runOwnedDocker(args,180000,image,undefined,journal);
 const qa=await technicalVideoQa(stageDir,image,'output/final.mp4',{width:1280,height:720,durationSec:20,fps:24,audio:true,audioChannels:2});report.technicalQa=qa;
 const narration=await readNarrationJson(store,voiceRecord.planRef,rev+'/voice-plan/') as NarrationPlan,verified=await readNarrationJson(store,voiceRecord.verifiedRef,rev+'/voice-verified/') as VerifiedNarrationManifest,film={outputPath:join(outputDir,'final.mp4'),sha256:qa.sha256,durationMs:20000,technicalQa:'pass' as const};
 report.postMix=await verifyPostMixNarration(root,film,narration,verified,env,undefined,{journal});report.status='pass';
 }catch(error){report.status='failed';report.errorCode=(error as Error).message;process.exitCode=1}
 report.sourceStateUnchanged=canonicalHash(before)===canonicalHash(await Promise.all(keys.map(async key=>canonicalHash((await store.readFresh(key)).value))));report.finishedAt=new Date().toISOString();await writeFile(reportPath,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,errorCode:report.errorCode,postMix:report.postMix,sourceStateUnchanged:report.sourceStateUnchanged}));
}
main().catch(error=>{console.error(error.message);process.exitCode=1});
