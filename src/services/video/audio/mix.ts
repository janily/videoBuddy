import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdir} from 'node:fs/promises';
import {isAbsolute,join,relative} from 'node:path';
import {Environment} from '@/services/video/config/environment';
import {dockerConfiguration} from '@/services/video/media/docker-executor';
import {NarrationManifest} from './narration';
import {inspectTrackWav,inspectVoiceWav,TrackWavProbe} from './wav';

export interface NarrationTrack{outputPath:string;runtimeDigest:string;wav:TrackWavProbe;kind:'narration_only';qaStatus:'not_checked'}
export function mixStageKey(manifest:NarrationManifest,runtimeDigest:string){
 if(!/^[a-f0-9]{64}$/.test(runtimeDigest))throw Error('AUDIO_RUNTIME_UNAVAILABLE');
 return createHash('sha256').update(JSON.stringify([manifest.durationMs,manifest.lines.map(line=>[line.lineId,line.startMs,line.durationMs,line.voice.wav.sha256]),runtimeDigest,'narration-v1'])).digest('hex');
}
export function mixDockerArguments(image:string,user:string,outputDir:string,inputs:Array<{path:string;startMs:number}>,durationMs:number){
 if(!/^sha256:[a-f0-9]{64}$/.test(image)||!/^\d+:\d+$/.test(user)||!isAbsolute(outputDir)||!/^\/[A-Za-z0-9_./-]+$/.test(outputDir)||!Number.isInteger(durationMs)||durationMs<20000||durationMs>120000||inputs.length>120)throw Error('AUDIO_JOB_INVALID');
 const mounts:string[]=[];
 for(let i=0;i<inputs.length;i++){
  const input=inputs[i];if(!isAbsolute(input.path)||!/^\/[A-Za-z0-9_./-]+$/.test(input.path)||!Number.isInteger(input.startMs)||input.startMs<0)throw Error('AUDIO_JOB_INVALID');
  mounts.push('--mount',`type=bind,src=${input.path},dst=/input/${i}.wav,readonly`);
 }
 const args=['run','--rm','--network','none','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges','--pids-limit','64','--cpus','2','--memory','1g','--memory-swap','1g','--user',user,'--tmpfs','/tmp:rw,nosuid,size=64m',...mounts,'--mount',`type=bind,src=${outputDir},dst=/output`,image,'ffmpeg','-hide_banner','-loglevel','error','-nostdin','-y','-f','lavfi','-t',String(durationMs/1000),'-i','anullsrc=r=48000:cl=mono'];
 for(let i=0;i<inputs.length;i++)args.push('-i',`/input/${i}.wav`);
 const shifted=inputs.map((input,i)=>`[${i+1}:a]aresample=48000,adelay=${input.startMs*48}S[v${i}]`);
 const filter=inputs.length?[...shifted,`[0:a]${inputs.map((_,i)=>`[v${i}]`).join('')}amix=inputs=${inputs.length+1}:duration=first:normalize=0[out]`].join(';'):'[0:a]anull[out]';
 args.push('-filter_complex',filter,'-map','[out]','-c:a','pcm_f32le','-ar','48000','-ac','1','/output/track.wav');
 return args;
}
async function runMix(args:string[]){
 const child=spawn('docker',args,{stdio:['ignore','ignore','pipe'],signal:AbortSignal.timeout(120000)}),errors:Buffer[]=[];let length=0;
 child.stderr.on('data',(part:Buffer)=>{length+=part.length;if(length<=8192)errors.push(part)});
 const code=await new Promise<number>((resolve,reject)=>{child.once('error',reject);child.once('close',code=>resolve(code??1))});
 if(code!==0)throw Error(`AUDIO_MIX_FAILED: docker exit ${code}; ${Buffer.concat(errors).toString('utf8').slice(0,300)}`);
}
export async function buildNarrationTrack(root:string,manifest:NarrationManifest,env:Environment=process.env):Promise<NarrationTrack>{
 if(!isAbsolute(root)||!Number.isInteger(manifest.durationMs)||manifest.durationMs<20000||manifest.durationMs>120000||manifest.lines.length>120)throw Error('AUDIO_JOB_INVALID');
 const config=dockerConfiguration(env,'audio-mix'),key=mixStageKey(manifest,config.runtimeDigest),outputDir=join(root,'audio',key),outputPath=join(outputDir,'track.wav');
 const voiceRoot=join(root,'voice');
 for(const line of manifest.lines){
  const inputPath=line.voice.outputPath,rel=relative(voiceRoot,inputPath);
  if(!isAbsolute(inputPath)||rel.startsWith('..')||isAbsolute(rel)||line.durationMs!==line.voice.wav.durationMs||!Number.isInteger(line.startMs)||line.startMs<0||line.startMs+line.durationMs>manifest.durationMs)throw Error('AUDIO_JOB_INVALID');
  const verified=await inspectVoiceWav(inputPath);
  if(verified.sha256!==line.voice.wav.sha256||verified.durationMs!==line.durationMs)throw Error('AUDIO_SOURCE_CHANGED');
 }
 await mkdir(outputDir,{recursive:true,mode:0o700});
 let wav:TrackWavProbe;
 try{wav=await inspectTrackWav(outputPath,manifest.durationMs*48,manifest.lines.length===0)}catch(error){
  if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;
  await runMix(mixDockerArguments(config.image,config.user,outputDir,manifest.lines.map(line=>({path:line.voice.outputPath,startMs:line.startMs})),manifest.durationMs));
  wav=await inspectTrackWav(outputPath,manifest.durationMs*48,manifest.lines.length===0);
 }
 return{outputPath,runtimeDigest:config.runtimeDigest,wav,kind:'narration_only',qaStatus:'not_checked'};
}
