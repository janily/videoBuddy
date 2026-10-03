import {runOwnedDocker} from '@/services/video/media/owned-docker';
import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {lstat,mkdir} from 'node:fs/promises';
import {isAbsolute,join,relative} from 'node:path';
import {Environment} from '@/services/video/config/environment';
import {dockerConfiguration} from '@/services/video/media/docker-executor';
import {NarrationPlan} from './narration';
import {VerifiedNarrationManifest,transcribeAudio,verifySpokenText} from './asr';
import {inspectTrackWav,inspectVoiceWav} from './wav';
import {loadAudioExecution} from './execution-package';
import type {AtomicStore} from '@/services/video/storage/atomic-store';
import type {ObjectRef} from '@/contracts/video/domain';

export interface PostMixFilm{outputPath:string;sha256:string;durationMs:number;technicalQa:'pass'}
function postMixDockerBase(image:string,user:string,filmPath:string,outputDir:string){
 if(!/^sha256:[a-f0-9]{64}$/.test(image)||!/^\d+:\d+$/.test(user)||[filmPath,outputDir].some(path=>!isAbsolute(path)||!/^\/[A-Za-z0-9_./-]+$/.test(path)))throw Error('POSTMIX_JOB_INVALID');
 return['run','--rm','--network','none','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges','--pids-limit','64','--cpus','2','--memory','1g','--memory-swap','1g','--user',user,'--tmpfs','/tmp:rw,nosuid,size=64m','--mount',`type=bind,src=${filmPath},dst=/input/final.mp4,readonly`,'--mount',`type=bind,src=${outputDir},dst=/output`,image,'ffmpeg','-hide_banner','-loglevel','error','-xerror','-nostdin','-y','-i','/input/final.mp4'];
}
export function postMixDockerArguments(image:string,user:string,filmPath:string,outputDir:string,startMs:number,lengthMs:number){
 if(!Number.isFinite(startMs)||startMs<0||!Number.isFinite(lengthMs)||lengthMs<200||lengthMs>30000)throw Error('POSTMIX_JOB_INVALID');
 const start=Math.floor(startMs),end=Math.ceil(startMs+lengthMs);
 return[...postMixDockerBase(image,user,filmPath,outputDir),'-ss',String(start/1000),'-t',String((end-start)/1000),'-map','0:a:0','-vn','-ar','24000','-ac','1','-c:a','pcm_f32le','/output/line.wav'];
}
export function postMixSilenceDockerArguments(image:string,user:string,filmPath:string,outputDir:string){
 return[...postMixDockerBase(image,user,filmPath,outputDir),'-map','0:a:0','-vn','-ar','48000','-ac','1','-c:a','pcm_f32le','/output/track.wav'];
}
export async function verifiedFilmHash(root:string,film:PostMixFilm){
 const path=film.outputPath,rel=relative(join(root,'composition'),path);
 if(!isAbsolute(root)||!isAbsolute(path)||rel.startsWith('..')||isAbsolute(rel)||!/^\/[A-Za-z0-9_./-]+$/.test(path)||!/^\/[A-Za-z0-9_./-]+$/.test(root)||!Number.isSafeInteger(film.durationMs)||film.durationMs<20000||film.durationMs>120000||film.technicalQa!=='pass'||!/^[a-f0-9]{64}$/.test(film.sha256))throw Error('POSTMIX_SOURCE_INVALID');
 const file=await lstat(path);if(!file.isFile()||file.isSymbolicLink()||file.nlink!==1||file.size<1024)throw Error('POSTMIX_SOURCE_INVALID');
 const hash=createHash('sha256');for await(const chunk of createReadStream(path))hash.update(chunk);
 if(hash.digest('hex')!==film.sha256)throw Error('POSTMIX_SOURCE_CHANGED');
}
// ASR applicability is established by actual archived zero voice PCM and the
// frozen synthesis-only execution. This is not a listening or final quality pass.
export async function verifyPostMixNoNarration(store:AtomicStore,root:string,film:PostMixFilm,projectId:string,revisionId:string,executionRef:ObjectRef,planRef:ObjectRef,timingRef:ObjectRef){
 const loaded=await loadAudioExecution(store,root,projectId,revisionId,executionRef,planRef,timingRef),voice=loaded.package.tracks.voice.wav;
 if(loaded.package.durationMs!==film.durationMs||!voice.silence||voice.peakDbfs!==null||voice.rmsDbfs!==null)throw Error('POSTMIX_PLAN_CHANGED');
 await verifiedFilmHash(root,film);
 return{status:'not_applicable' as const,reason:'no_narration' as const,filmSha256:film.sha256,executionSha256:executionRef.sha256,voiceTrackSha256:voice.sha256,lines:[]};
}
export async function verifyPostMixNarration(root:string,film:PostMixFilm,originalPlan:NarrationPlan,verified:VerifiedNarrationManifest,env:Environment=process.env,onMismatch?:(lineId:string,recognizedText:string)=>void,options:{assertActive?:()=>Promise<void>;mustExist?:boolean}={}){
 await options.assertActive?.();
 if(originalPlan.durationMs!==film.durationMs||verified.durationMs!==film.durationMs||originalPlan.lines.length!==verified.lines.length)throw Error('POSTMIX_PLAN_CHANGED');
 await verifiedFilmHash(root,film);
 if(verified.lines.length===0){
  const config=dockerConfiguration(env,'postmix-asr');
  const key=createHash('sha256').update(JSON.stringify([film.sha256,config.runtimeDigest,'postmix-silence-v1'])).digest('hex');
  const outputDir=join(root,'postmix',key,'output'),outputPath=join(outputDir,'track.wav');
  if(!options.mustExist)await mkdir(outputDir,{recursive:true,mode:0o700});
  let track;try{track=await inspectTrackWav(outputPath,film.durationMs*48,true,1024)}catch(error){
   if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;
   if(options.mustExist)throw Error('POSTMIX_EVIDENCE_MISSING');
   await runOwnedDocker(postMixSilenceDockerArguments(config.image,config.user,film.outputPath,outputDir),60000,config.image,options.assertActive);
   track=await inspectTrackWav(outputPath,film.durationMs*48,true,1024);
  }
  await options.assertActive?.();
  if(!track.silence||track.peakDbfs!==null&&track.peakDbfs>=-46||track.rmsDbfs!==null&&track.rmsDbfs>=-60)throw Error('POSTMIX_UNEXPECTED_AUDIO');
  return{status:'not_applicable' as const,reason:'intentional_silence' as const,filmSha256:film.sha256,trackSha256:track.sha256,samples:track.samples,peakDbfs:track.peakDbfs,rmsDbfs:track.rmsDbfs,lines:[]};
 }
 const config=dockerConfiguration(env,'postmix-asr'),source=new Map(originalPlan.lines.map(line=>[line.lineId,line]));
 if(source.size!==originalPlan.lines.length||new Set(verified.lines.map(line=>line.lineId)).size!==verified.lines.length)throw Error('POSTMIX_PLAN_CHANGED');
 const ordered=[...verified.lines].sort((a,b)=>a.startMs-b.startMs),results=[];
 for(const [index,line] of ordered.entries()){
  await options.assertActive?.();
  const original=source.get(line.lineId);
  if(!original||original.language!==line.language||original.spokenText!==line.spokenText||original.displayText!==line.displayText||original.expectedAsrText!==line.expectedAsrText||original.startMs!==line.startMs||original.reservedMs!==line.reservedMs||line.asrStatus!=='pass'||line.wordTimingsStatus!=='available'||line.durationMs<=0)throw Error('POSTMIX_PLAN_CHANGED');
  const nextStart=ordered[index+1]?.startMs??film.durationMs,lengthMs=Math.min(line.durationMs+300,nextStart-line.startMs,film.durationMs-line.startMs);
  if(lengthMs<line.durationMs||lengthMs>30000)throw Error('POSTMIX_PLAN_CHANGED');
  const key=createHash('sha256').update(JSON.stringify([film.sha256,line.lineId,line.language,line.startMs,lengthMs,config.runtimeDigest,'postmix-v1'])).digest('hex');
  const stageDir=join(root,'postmix',key),outputDir=join(stageDir,'output'),outputPath=join(outputDir,'line.wav');if(!options.mustExist)await mkdir(outputDir,{recursive:true,mode:0o700});
  let wav;try{wav=await inspectVoiceWav(outputPath)}catch(error){
   if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;
   if(options.mustExist)throw Error('POSTMIX_EVIDENCE_MISSING');
   await runOwnedDocker(postMixDockerArguments(config.image,config.user,film.outputPath,outputDir,line.startMs,lengthMs),60000,config.image,options.assertActive);
   wav=await inspectVoiceWav(outputPath);
  }
  await options.assertActive?.();
  const transcript=await transcribeAudio(root,{language:line.language,outputPath,wav},'postmix',env,options);
  await options.assertActive?.();
  let checked:ReturnType<typeof verifySpokenText>;
  try{checked=verifySpokenText(original.expectedAsrText,line.expectedAsrText,transcript)}
  catch(error){if((error as Error).message!=='ASR_MISMATCH')throw error;onMismatch?.(line.lineId,transcript.recognizedText);throw Error(`POSTMIX_ASR_MISMATCH: ${line.lineId}`)}
  results.push({lineId:line.lineId,recognizedText:checked.recognizedText,sourceSha256:wav.sha256,asrRuntimeDigest:transcript.runtimeDigest,wordCount:checked.words.length,status:checked.status});
 }
 return{status:'pass' as const,filmSha256:film.sha256,lines:results};
}
