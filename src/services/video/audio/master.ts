import {runOwnedDocker} from '@/services/video/media/owned-docker';
import type {DockerJournal} from '@/services/video/media/docker-journal';
import {createHash} from 'node:crypto';
import {lstat,mkdir,open,readFile} from 'node:fs/promises';
import {isAbsolute,join,resolve,relative} from 'node:path';
import {AudioPlanSchema,type AudioPlan} from '@/contracts/video/audio-plan';
import {canonicalHash,canonicalJson} from '@/services/video/domain/hash';
import type {Environment} from '@/services/video/config/environment';
import {dockerConfiguration} from '@/services/video/media/docker-executor';
import {compileSoundJob,frozenAudioInput,type buildSoundStems} from './sound';
import type {NarrationTrack} from './mix';
import {inspectTrackWav,inspectStereoTrackWav,type StereoTrackWavProbe} from './wav';

export interface FilmAudioTrack{outputPath:string;runtimeDigest:string;wav:StereoTrackWavProbe;kind:'film_mix';qaStatus:'not_checked'}
export type CompositionTrack=NarrationTrack|FilmAudioTrack;
export {masterMixFilter} from './master-filter';
import {masterMixFilter} from './master-filter';
type Stems=Awaited<ReturnType<typeof buildSoundStems>>;
function inside(root:string,path:string){const rel=relative(root,path);if(!isAbsolute(path)||!rel||rel.startsWith('..')||isAbsolute(rel)||!/^\/[A-Za-z0-9_./-]+$/.test(path))throw Error('AUDIO_SOURCE_CHANGED')}
export async function buildAudioMaster(root:string,raw:AudioPlan,narration:NarrationTrack,stems:Stems,durationMs:number,fps:24|30|60,env:Environment=process.env,options:{musicGainDb?:number;assertActive?:()=>Promise<void>;journal?:DockerJournal}={}):Promise<{stageKey:string;musicGainDb?:number;planSha256:string;toolSha256:string;voiceSha256:string;musicSha256:string;foleySha256:string;track:FilmAudioTrack;qualityStatus:'listening_not_checked'}>{
 await options.assertActive?.();
 if(!isAbsolute(root)||!/^\/[A-Za-z0-9_./-]+$/.test(root))throw Error('AUDIO_JOB_INVALID');
 const plan=AudioPlanSchema.parse(raw),job=compileSoundJob(plan,durationMs,fps),config=dockerConfiguration(env,'audio-master');
 inside(join(root,'audio'),narration.outputPath);inside(join(root,'sound'),stems.music.outputPath);inside(join(root,'sound'),stems.foley.outputPath);
 const voice=await inspectTrackWav(narration.outputPath,job.samples,true),music=await inspectStereoTrackWav(stems.music.outputPath,job.samples,plan.music.length===0),foley=await inspectStereoTrackWav(stems.foley.outputPath,job.samples,plan.foley.length===0);
 if(canonicalHash(voice)!==canonicalHash(narration.wav)||canonicalHash(music)!==canonicalHash(stems.music.wav)||canonicalHash(foley)!==canonicalHash(stems.foley.wav)||stems.planSha256!==job.planSha256||narration.runtimeDigest!==config.runtimeDigest||stems.runtimeDigest!==config.runtimeDigest)throw Error('AUDIO_SOURCE_CHANGED');
 const hasVoice=!voice.silence,filter=masterMixFilter(plan.mix,job.samples,hasVoice,options.musicGainDb),document={schemaVersion:options.musicGainDb===undefined?1:2,...(options.musicGainDb===undefined?{}:{musicGainDb:options.musicGainDb}),planSha256:job.planSha256,samples:job.samples,hasVoice,mix:plan.mix,filter,inputSha256:{voice:voice.sha256,music:music.sha256,foley:foley.sha256}};
 const toolPaths=['master.py','sound.py'].map(name=>resolve('runtime/media',name)),tools:Buffer[]=[];
 for(const path of toolPaths){const info=await lstat(path);if(!info.isFile()||info.isSymbolicLink()||info.nlink!==1)throw Error('AUDIO_TOOL_INVALID');tools.push(await readFile(path))}
 const toolSha256=canonicalHash(tools.map(bytes=>createHash('sha256').update(bytes).digest('hex'))),stageKey=canonicalHash({document,runtimeDigest:config.runtimeDigest,toolSha256}),stageDir=join(root,'audio-master',stageKey),outputDir=join(stageDir,'output');
 await mkdir(outputDir,{recursive:true,mode:0o700});await frozenAudioInput(join(stageDir,'job.json'),Buffer.from(canonicalJson(document)));
 for(const [index,name] of ['master.py','sound.py'].entries())await frozenAudioInput(join(stageDir,name),tools[index]);
 const dir=await open(stageDir,'r');try{await dir.sync()}finally{await dir.close()}
 const mounts:string[]=[];
 for(const [name,path] of [['master.py',join(stageDir,'master.py')],['sound.py',join(stageDir,'sound.py')],['job.json',join(stageDir,'job.json')],['voice.wav',narration.outputPath],['music.wav',stems.music.outputPath],['foley.wav',stems.foley.outputPath]])mounts.push('--mount','type=bind,src='+path+',dst=/input/'+name+',readonly');
 const args=['run','--rm','--network','none','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges','--pids-limit','64','--cpus','2','--memory','1g','--memory-swap','1g','--user',config.user,'--tmpfs','/tmp:rw,nosuid,size=64m',...mounts,'--mount','type=bind,src='+outputDir+',dst=/output',config.image,'python3','/input/master.py','--job','/input/job.json','--output','/output'];
 await runOwnedDocker(args,config.timeoutSeconds*1000,config.image,options.assertActive,...(options.journal?[options.journal]:[]));
 await options.assertActive?.();
 const outputPath=join(outputDir,'master.wav'),wav=await inspectStereoTrackWav(outputPath,job.samples,voice.silence&&music.silence&&foley.silence),state=JSON.parse(await readFile(join(outputDir,'state.json'),'utf8'));
 if(state.jobSha256!==canonicalHash(document)||state.outputSha256!==wav.sha256)throw Error('AUDIO_MASTER_CHANGED');
 await options.assertActive?.();
 return{stageKey,...(options.musicGainDb===undefined?{}:{musicGainDb:options.musicGainDb}),planSha256:job.planSha256,toolSha256,voiceSha256:voice.sha256,musicSha256:music.sha256,foleySha256:foley.sha256,track:{outputPath,runtimeDigest:config.runtimeDigest,wav,kind:'film_mix',qaStatus:'not_checked'},qualityStatus:'listening_not_checked'};
}
