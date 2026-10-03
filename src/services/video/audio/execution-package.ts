import {constants} from 'node:fs';
import {open,readFile,realpath} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {isAbsolute,join} from 'node:path';
import {z} from 'zod';
import {ObjectRefSchema,type ObjectRef} from '@/contracts/video/domain';
import {AudioPlanSchema,type AudioPlan} from '@/contracts/video/audio-plan';
import {canonicalHash,canonicalJson} from '@/services/video/domain/hash';
import {createOrRead,type AtomicStore} from '@/services/video/storage/atomic-store';
import type {ProjectStore} from '@/services/video/storage/project-store';
import {TimingDraftSchema,type TimingDraft} from '@/services/video/preview/timing-draft';
import {readNarrationJson,runObjectHelper} from './narration-package';
import {compileSoundJob,type buildSoundStems} from './sound';
import type {buildAudioMaster,FilmAudioTrack} from './master';
import {masterMixFilter} from './master-filter';
import type {NarrationTrack} from './mix';
import {probeTrackWav,probeStereoTrackWav} from './wav';

const digest=z.string().regex(/^[a-f0-9]{64}$/);
const wav=z.strictObject({codec:z.literal('pcm_f32le'),sampleRate:z.literal(48000),channels:z.union([z.literal(1),z.literal(2)]),samples:z.number().int().min(960000).max(5760000),durationMs:z.number().min(20000).max(120000),bytes:z.number().int().min(44).max(64*1024*1024),sha256:digest,peakDbfs:z.number().finite().nullable(),rmsDbfs:z.number().finite().nullable(),silence:z.boolean()});
const track=z.strictObject({audioRef:ObjectRefSchema,wav});
const execution=z.strictObject({stageKey:digest,toolSha256:digest,planSha256:digest});
const ExecutionV2=z.strictObject({schemaVersion:z.literal(2),kind:z.literal('executed_audio'),briefVersion:z.number().int().nonnegative(),planRef:ObjectRefSchema,timingDraftRef:ObjectRefSchema,seed:z.number().int().min(0).max(0xffffffff),fps:z.union([z.literal(24),z.literal(30),z.literal(60)]),durationMs:z.number().int().min(20000).max(120000),totalSamples:z.number().int().min(960000).max(5760000),runtimeDigest:digest,sound:execution,master:execution,toolsRef:ObjectRefSchema,receiptsRef:ObjectRefSchema,tracks:z.strictObject({voice:track,music:track,foley:track,mix:track}),qualityStatus:z.literal('listening_not_checked')});
export const AudioExecutionSchema=z.discriminatedUnion('schemaVersion',[ExecutionV2,ExecutionV2.extend({schemaVersion:z.literal(3),master:execution.extend({musicGainDb:z.number().min(-6).max(0)})})]);
export type AudioExecution=z.infer<typeof AudioExecutionSchema>;
const ToolsSchema=z.strictObject({schemaVersion:z.literal(1),kind:z.literal('trusted_audio_tools'),soundSource:z.string().min(1).max(100000),masterSource:z.string().min(1).max(100000)});
const ReceiptsSchema=z.strictObject({schemaVersion:z.literal(1),kind:z.literal('audio_execution_receipts'),soundState:z.strictObject({schemaVersion:z.literal(1),jobSha256:digest,outputs:z.strictObject({music:digest,foley:digest})}),masterState:z.strictObject({schemaVersion:z.literal(1),jobSha256:digest,outputSha256:digest})});
type Receipts=z.infer<typeof ReceiptsSchema>;
function masterDocument(data:AudioExecution,plan:AudioPlan){
 const {voice,music,foley}=data.tracks;
 const gain=data.schemaVersion===3?data.master.musicGainDb:undefined;
 return{schemaVersion:gain===undefined?1:2,...(gain===undefined?{}:{musicGainDb:gain}),planSha256:canonicalHash(plan),samples:data.totalSamples,hasVoice:!voice.wav.silence,mix:plan.mix,filter:masterMixFilter(plan.mix,data.totalSamples,!voice.wav.silence,gain),inputSha256:{voice:voice.wav.sha256,music:music.wav.sha256,foley:foley.wav.sha256}};
}
type Stems=Awaited<ReturnType<typeof buildSoundStems>>;
type Master=Awaited<ReturnType<typeof buildAudioMaster>>;
function prefix(projectId:string,revisionId:string){
 if(![projectId,revisionId].every(id=>z.uuid().safeParse(id).success))throw Error('AUDIO_EXECUTION_CHANGED');
 return 'projects/'+projectId+'/revisions/'+revisionId+'/';
}
function sha(bytes:Buffer|string){return createHash('sha256').update(bytes).digest('hex')}
async function safeBytes(path:string,base:string){
 const baseReal=await realpath(base),actual=await realpath(path);
 if(!actual.startsWith(baseReal+'/'))throw Error('AUDIO_EXECUTION_CHANGED');
 const file=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);
 try{
  const info=await file.stat();
  if(!info.isFile()||info.nlink!==1||info.size<44||info.size>64*1024*1024)throw Error('AUDIO_EXECUTION_CHANGED');
  const bytes=await file.readFile(),after=await file.stat();
  if(info.size!==bytes.length||info.size!==after.size||info.mtimeMs!==after.mtimeMs||info.ctimeMs!==after.ctimeMs||after.nlink!==1)throw Error('AUDIO_EXECUTION_CHANGED');
  return bytes;
 }finally{await file.close()}
}
async function baseline(store:AtomicStore,p:string,planRef:ObjectRef,timingRef:ObjectRef){
 const plan=AudioPlanSchema.parse(await readNarrationJson(store,planRef,p+'audio-plan/')),timing=TimingDraftSchema.parse(await readNarrationJson(store,timingRef,p+'timing-draft/'));
 if(plan.timingDraftHash!==timingRef.sha256||plan.briefVersion!==timing.briefVersion||plan.styleSlug!==timing.styleSlug||plan.styleRulesHash!==timing.styleRulesHash)throw Error('AUDIO_EXECUTION_CHANGED');
 compileSoundJob(plan,timing.durationMs,timing.fps);
 return{plan,timing};
}
function check(data:AudioExecution,plan:AudioPlan,timing:TimingDraft,tools:z.infer<typeof ToolsSchema>,receipts:Receipts){
 const voice=data.tracks.voice.wav,music=data.tracks.music.wav,foley=data.tracks.foley.wav,mix=data.tracks.mix.wav,job=compileSoundJob(plan,timing.durationMs,timing.fps);
 if(data.briefVersion!==plan.briefVersion||data.seed!==plan.seed||data.fps!==timing.fps||data.durationMs!==timing.durationMs||data.totalSamples!==timing.durationMs*48||data.runtimeDigest!==timing.track.runtimeDigest||voice.channels!==1||voice.sha256!==timing.track.sha256||voice.samples!==timing.track.samples||voice.silence!==timing.track.silence||voice.silence!==(timing.narration.length===0)||timing.narration.length===0&&voice.peakDbfs!==null||[music,foley,mix].some(w=>w.channels!==2)||Object.values(data.tracks).some(t=>t.wav.samples!==data.totalSamples||t.wav.durationMs!==data.durationMs)||plan.music.length===0&&music.peakDbfs!==null||plan.foley.length===0&&foley.peakDbfs!==null||plan.music.length>0&&music.silence||plan.foley.length>0&&foley.silence)throw Error('AUDIO_EXECUTION_CHANGED');
 if(data.sound.planSha256!==canonicalHash(plan)||data.master.planSha256!==canonicalHash(plan)||data.sound.toolSha256!==sha(tools.soundSource)||data.master.toolSha256!==canonicalHash([sha(tools.masterSource),sha(tools.soundSource)]))throw Error('AUDIO_EXECUTION_CHANGED');
 const soundKey=canonicalHash({job,runtimeDigest:data.runtimeDigest,toolSha256:data.sound.toolSha256,layout:'output-only-v2'});
 const document=masterDocument(data,plan);
 const expectedReceipts={schemaVersion:1,kind:'audio_execution_receipts',soundState:{schemaVersion:1,jobSha256:canonicalHash(job),outputs:{music:music.sha256,foley:foley.sha256}},masterState:{schemaVersion:1,jobSha256:canonicalHash(document),outputSha256:mix.sha256}};
 if(canonicalHash(receipts)!==canonicalHash(expectedReceipts)||mix.silence!==(voice.peakDbfs===null&&music.peakDbfs===null&&foley.peakDbfs===null))throw Error('AUDIO_EXECUTION_CHANGED');
 if(data.sound.stageKey!==soundKey||data.master.stageKey!==canonicalHash({document,runtimeDigest:data.runtimeDigest,toolSha256:data.master.toolSha256}))throw Error('AUDIO_EXECUTION_CHANGED');
}
export async function loadAudioExecution(store:AtomicStore,root:string,projectId:string,revisionId:string,ref:ObjectRef,planRef:ObjectRef,timingRef:ObjectRef){
 try{
  if(!isAbsolute(root))throw Error('AUDIO_EXECUTION_CHANGED');
  const p=prefix(projectId,revisionId),data=AudioExecutionSchema.parse(await readNarrationJson(store,ref,p+'audio-execution/'));
  if(canonicalHash(data.planRef)!==canonicalHash(planRef)||canonicalHash(data.timingDraftRef)!==canonicalHash(timingRef))throw Error('AUDIO_EXECUTION_CHANGED');
  const{plan,timing}=await baseline(store,p,planRef,timingRef),tools=ToolsSchema.parse(await readNarrationJson(store,data.toolsRef,p+'audio-tools/'));
  const receipts=ReceiptsSchema.parse(await readNarrationJson(store,data.receiptsRef,p+'audio-receipts/'));
  check(data,plan,timing,tools,receipts);
  // These fixed, input-addressed slots are the durable authority. Re-signing
  // a new content-addressed package/receipt cannot redirect the executed output.
  const actualSound=(await store.readFresh(p+'audio-run-receipts/sound/'+data.sound.stageKey)).value;
  const actualMaster=(await store.readFresh(p+'audio-run-receipts/master/'+data.master.stageKey)).value;
  if(canonicalHash(actualSound)!==canonicalHash(receipts.soundState)||canonicalHash(actualMaster)!==canonicalHash(receipts.masterState))throw Error('AUDIO_EXECUTION_CHANGED');
  for(const [bus,entry] of Object.entries(data.tracks)){
   const key=p+'sound-files/'+entry.wav.sha256+'.wav';
   if(entry.audioRef.key!==key||entry.audioRef.mime!=='audio/wav'||entry.audioRef.bytes!==entry.wav.bytes||entry.audioRef.sha256!==entry.wav.sha256)throw Error('AUDIO_EXECUTION_CHANGED');
   await runObjectHelper(root,'verify',key,entry.wav.bytes);
   const bytes=await safeBytes(join(root,'objects',key),join(root,'objects'));
   const actual=bus==='voice'?probeTrackWav(bytes,data.totalSamples,true):probeStereoTrackWav(bytes,data.totalSamples,true);
   if(canonicalHash(actual)!==canonicalHash(entry.wav))throw Error('AUDIO_EXECUTION_CHANGED');
  }
  const mix=data.tracks.mix,probe=probeStereoTrackWav(await safeBytes(join(root,'objects',mix.audioRef.key),join(root,'objects')),data.totalSamples,true);
  const track:FilmAudioTrack={outputPath:join(root,'objects',mix.audioRef.key),runtimeDigest:data.runtimeDigest,wav:probe,kind:'film_mix',qaStatus:'not_checked'};
  return{package:data,track};
 }catch{throw Error('AUDIO_EXECUTION_CHANGED')}
}
export async function archiveAudioExecution(projects:ProjectStore,root:string,projectId:string,revisionId:string,planRef:ObjectRef,timingRef:ObjectRef,narration:NarrationTrack,stems:Stems,master:Master):Promise<ObjectRef>{
 try{
  const p=prefix(projectId,revisionId),{plan,timing}=await baseline(projects.store,p,planRef,timingRef);
  if(!isAbsolute(root)||narration.outputPath!==timing.track.outputPath||narration.runtimeDigest!==timing.track.runtimeDigest||stems.runtimeDigest!==timing.track.runtimeDigest||master.track.runtimeDigest!==timing.track.runtimeDigest||master.voiceSha256!==narration.wav.sha256||master.musicSha256!==stems.music.wav.sha256||master.foleySha256!==stems.foley.wav.sha256)throw Error('AUDIO_EXECUTION_CHANGED');
  const tools=ToolsSchema.parse({schemaVersion:1,kind:'trusted_audio_tools',soundSource:await readFile('runtime/media/sound.py','utf8'),masterSource:await readFile('runtime/media/master.py','utf8')});
  const actuals=await Promise.all([safeBytes(narration.outputPath,join(root,'audio')),safeBytes(stems.music.outputPath,join(root,'sound',stems.stageKey,'output')),safeBytes(stems.foley.outputPath,join(root,'sound',stems.stageKey,'output')),safeBytes(master.track.outputPath,join(root,'audio-master',master.stageKey,'output'))]);
  const tracks={} as AudioExecution['tracks'],buses=['voice','music','foley','mix'] as const;
  for(const [index,bus] of buses.entries()){
   const actual=index===0?probeTrackWav(actuals[index],timing.durationMs*48,true):probeStereoTrackWav(actuals[index],timing.durationMs*48,true),expected=[narration.wav,stems.music.wav,stems.foley.wav,master.track.wav][index];
   if(canonicalHash(actual)!==canonicalHash(expected))throw Error('AUDIO_EXECUTION_CHANGED');
   tracks[bus]={wav:actual,audioRef:{key:p+'sound-files/'+actual.sha256+'.wav',sha256:actual.sha256,bytes:actual.bytes,mime:'audio/wav'}};
  }
  const toolSha=canonicalHash(tools),toolsRef={key:p+'audio-tools/'+toolSha,sha256:toolSha,bytes:Buffer.byteLength(canonicalJson(tools)),mime:'application/json'};
  const soundState=JSON.parse((await safeBytes(join(root,'sound',stems.stageKey,'output','state.json'),join(root,'sound',stems.stageKey,'output'))).toString('utf8'));
  const masterState=JSON.parse((await safeBytes(join(root,'audio-master',master.stageKey,'output','state.json'),join(root,'audio-master',master.stageKey,'output'))).toString('utf8'));
  const receipts=ReceiptsSchema.parse({schemaVersion:1,kind:'audio_execution_receipts',soundState,masterState}),receiptSha=canonicalHash(receipts),receiptsRef={key:p+'audio-receipts/'+receiptSha,sha256:receiptSha,bytes:Buffer.byteLength(canonicalJson(receipts)),mime:'application/json'};
  const data=AudioExecutionSchema.parse({schemaVersion:master.musicGainDb===undefined?2:3,kind:'executed_audio',briefVersion:plan.briefVersion,planRef,timingDraftRef:timingRef,seed:plan.seed,fps:timing.fps,durationMs:timing.durationMs,totalSamples:timing.durationMs*48,runtimeDigest:timing.track.runtimeDigest,sound:{stageKey:stems.stageKey,toolSha256:stems.toolSha256,planSha256:stems.planSha256},master:{stageKey:master.stageKey,toolSha256:master.toolSha256,planSha256:master.planSha256,...(master.musicGainDb===undefined?{}:{musicGainDb:master.musicGainDb})},toolsRef,receiptsRef,tracks,qualityStatus:'listening_not_checked'});
  check(data,plan,timing,tools,receipts);
  const soundJobBytes=await safeBytes(join(root,'sound',stems.stageKey,'job.json'),join(root,'sound',stems.stageKey));
  const masterJobBytes=await safeBytes(join(root,'audio-master',master.stageKey,'job.json'),join(root,'audio-master',master.stageKey));
  if(sha(soundJobBytes)!==receipts.soundState.jobSha256||sha(masterJobBytes)!==receipts.masterState.jobSha256)throw Error('AUDIO_EXECUTION_CHANGED');
  for(const [kind,state,key] of [['sound',receipts.soundState,stems.stageKey],['master',receipts.masterState,master.stageKey]] as const){
   const saved=await createOrRead(projects.store,p+'audio-run-receipts/'+kind+'/'+key,state);
   if(canonicalHash(saved)!==canonicalHash(state))throw Error('AUDIO_EXECUTION_CHANGED');
  }
  await projects.index.immutable(p+'audio-receipts',receipts);
  await projects.index.immutable(p+'audio-tools',tools);
  for(const [index,bus] of buses.entries())await runObjectHelper(root,'publish',tracks[bus].audioRef.key,actuals[index].length,actuals[index]);
  const ref=await projects.index.immutable(p+'audio-execution',data);
  await loadAudioExecution(projects.store,root,projectId,revisionId,ref,planRef,timingRef);
  return ref;
 }catch{throw Error('AUDIO_EXECUTION_CHANGED')}
}

export function synthSourceDocuments(source:AudioPlan['sources'][number],planRef:ObjectRef,runtimeDigest:string){
 if(source.kind!=='synthesis')throw Error('AUDIO_USER_TRACK_NOT_READY');
 return{
  document:{schemaVersion:1,kind:'generated_sound',id:source.id,planRef,source,runtimeDigest},
  rights:{basis:'generated',source:'Deterministic synthesis; recipe='+canonicalHash(source.recipe)+'; runtime='+runtimeDigest},
 };
}
export async function archiveSynthSources(projects:ProjectStore,projectId:string,revisionId:string,planRef:ObjectRef,plan:AudioPlan,runtimeDigest:string){
 const p=prefix(projectId,revisionId),sources=[];
 if(planRef.sha256!==canonicalHash(plan)||!planRef.key.startsWith(p+'audio-plan/'))throw Error('AUDIO_EXECUTION_CHANGED');
 for(const source of plan.sources){
  const docs=synthSourceDocuments(source,planRef,runtimeDigest);
  sources.push({id:source.id,kind:'generated' as const,sourceRef:await projects.index.immutable(p+'audio-source',docs.document),rightsRef:await projects.index.immutable(p+'sound-rights',docs.rights)});
 }
 return sources;
}
