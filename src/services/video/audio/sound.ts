import {runOwnedDocker} from '@/services/video/media/owned-docker';
import type {DockerJournal} from '@/services/video/media/docker-journal';
import {lstat,mkdir,readFile,open} from 'node:fs/promises';
import {isAbsolute,join,resolve} from 'node:path';
import {AudioPlanSchema,compileAudioCues,type AudioPlan} from '@/contracts/video/audio-plan';
import {canonicalHash,canonicalJson} from '@/services/video/domain/hash';
import {dockerConfiguration} from '@/services/video/media/docker-executor';
import type {Environment} from '@/services/video/config/environment';
import {inspectStereoTrackWav} from './wav';

export function compileSoundJob(raw:AudioPlan,durationMs:number,fps:24|30|60){
 const plan=AudioPlanSchema.parse(raw);
 if(!Number.isSafeInteger(durationMs)||durationMs<20000||durationMs>120000||![24,30,60].includes(fps))throw Error('AUDIO_JOB_INVALID');
 const samples=durationMs*48,sources=new Map(plan.sources.map(source=>[source.id,source])),cues=new Map(compileAudioCues(plan,fps).map(cue=>[cue.id,cue])),seen=new Set<string>();
 if(sources.size!==plan.sources.length||cues.size!==plan.cues.length)throw Error('AUDIO_EVENT_INVALID');
 const events=(['music','foley'] as const).flatMap(bus=>plan[bus].map(event=>{
  const source=sources.get(event.source),cue=cues.get(event.cueId);
  if(!source||!cue||seen.has(event.eventId)||cue.resolvedSample+event.durationSamples>samples)throw Error('AUDIO_EVENT_INVALID');
  if(source.kind!=='synthesis')throw Error('AUDIO_USER_TRACK_NOT_READY');
  if(source.recipe.frequencyHz*(event.pitch||1)>20000||(source.recipe.attackMs+source.recipe.releaseMs)*48>event.durationSamples)throw Error('AUDIO_EVENT_INVALID');
  for(const range of plan.intentionalSilenceRanges)if(range.buses.includes(bus)&&cue.resolvedSample<range.endSample&&cue.resolvedSample+event.durationSamples>range.startSample)throw Error('AUDIO_SILENCE_INVALID');
  seen.add(event.eventId);
  return{eventId:event.eventId,bus,startSample:cue.resolvedSample,durationSamples:event.durationSamples,gainDb:event.gainDb,pan:event.pan,frequencyHz:source.recipe.frequencyHz*(event.pitch||1),instrument:source.recipe.instrument,attackSamples:Math.round(source.recipe.attackMs*48),releaseSamples:Math.round(source.recipe.releaseMs*48),seed:parseInt(canonicalHash({seed:plan.seed,eventId:event.eventId}).slice(0,8),16)};
 }));
 return{schemaVersion:1 as const,planSha256:canonicalHash(plan),sampleRate:48000 as const,channels:2 as const,samples,events};
}
export type SoundJob=ReturnType<typeof compileSoundJob>;
export async function frozenAudioInput(path:string,bytes:Buffer){
 try{const file=await open(path,'wx',0o600);try{await file.writeFile(bytes);await file.sync()}finally{await file.close()}}
 catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;const info=await lstat(path);if(!info.isFile()||info.isSymbolicLink()||info.nlink!==1||!bytes.equals(await readFile(path)))throw Error('AUDIO_STAGE_CHANGED')}
}
export async function buildSoundStems(root:string,plan:AudioPlan,durationMs:number,fps:24|30|60,env:Environment=process.env,options:{assertActive?:()=>Promise<void>;journal?:DockerJournal}={}){
 await options.assertActive?.();
 if(!isAbsolute(root)||!/^\/[A-Za-z0-9_./-]+$/.test(root))throw Error('AUDIO_JOB_INVALID');
 const config=dockerConfiguration(env,'sound'),job=compileSoundJob(plan,durationMs,fps),toolPath=resolve('runtime/media/sound.py'),info=await lstat(toolPath);
 if(!info.isFile()||info.isSymbolicLink()||info.nlink!==1)throw Error('AUDIO_TOOL_INVALID');
 const toolBytes=await readFile(toolPath),toolSha256=(await import('node:crypto')).createHash('sha256').update(toolBytes).digest('hex'),stageKey=canonicalHash({job,runtimeDigest:config.runtimeDigest,toolSha256,layout:'output-only-v2'}),stageDir=join(root,'sound',stageKey),outputDir=join(stageDir,'output');
 await mkdir(outputDir,{recursive:true,mode:0o700});
 // The exact trusted tool bytes are archived and mounted read-only; no generated program runs in Python.
 await frozenAudioInput(join(stageDir,'sound.py'),toolBytes);await frozenAudioInput(join(stageDir,'job.json'),Buffer.from(canonicalJson(job)));
 const dir=await open(stageDir,'r');try{await dir.sync()}finally{await dir.close()}
 const args=['run','--rm','--network','none','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges','--pids-limit','64','--cpus','2','--memory','1g','--memory-swap','1g','--user',config.user,'--tmpfs','/tmp:rw,nosuid,size=64m','--mount','type=bind,src='+outputDir+',dst=/output','--mount','type=bind,src='+join(stageDir,'sound.py')+',dst=/input/sound.py,readonly','--mount','type=bind,src='+join(stageDir,'job.json')+',dst=/input/job.json,readonly',config.image,'python3','/input/sound.py','--job','/input/job.json','--output','/output'];
 await runOwnedDocker(args,config.timeoutSeconds*1000,config.image,options.assertActive,...(options.journal?[options.journal]:[]));
 await options.assertActive?.();
 const musicPath=join(outputDir,'music.wav'),foleyPath=join(outputDir,'foley.wav'),music=await inspectStereoTrackWav(musicPath,job.samples,plan.music.length===0),foley=await inspectStereoTrackWav(foleyPath,job.samples,plan.foley.length===0);
 const state=JSON.parse(await readFile(join(outputDir,'state.json'),'utf8'));
 if(state.jobSha256!==canonicalHash(job)||state.outputs?.music!==music.sha256||state.outputs?.foley!==foley.sha256)throw Error('AUDIO_SYNTHESIS_CHANGED');
 await options.assertActive?.();
 return{stageKey,planSha256:job.planSha256,runtimeDigest:config.runtimeDigest,toolSha256,music:{outputPath:musicPath,wav:music},foley:{outputPath:foleyPath,wav:foley},qualityStatus:'listening_not_checked' as const};
}
