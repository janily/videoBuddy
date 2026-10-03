import {mkdtemp,mkdir,readFile,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {FileStore} from '../../src/services/video/storage/file-store';
import {loadAudioExecution,AudioExecutionSchema} from '../../src/services/video/audio/execution-package';
import {AudioPlanSchema} from '../../src/contracts/video/audio-plan';
import {buildAudioMaster} from '../../src/services/video/audio/master';
import {frozenAudioInput} from '../../src/services/video/audio/sound';
import {canonicalHash} from '../../src/services/video/domain/hash';
import type {ProjectControl} from '../../src/contracts/video/project';
import {inspectTrackWav,inspectStereoTrackWav} from '../../src/services/video/audio/wav';

function pcm(bytes:Buffer){
 let offset=12;
 while(offset+8<=bytes.length){const size=bytes.readUInt32LE(offset+4);if(bytes.toString('ascii',offset,offset+4)==='data')return bytes.subarray(offset+8,offset+8+size);offset+=8+size+size%2}
 throw Error('REMIX_PCM_MISSING');
}
async function main(){
 if(!process.argv.includes('--remix'))throw Error('MUSIC_REMIX_OPT_IN_REQUIRED');
 const proof=JSON.parse(await readFile('docs/engineering/evidence/native-package-probe.json','utf8'));
 const store=new FileStore(proof.root),prefix=`projects/${proof.projectId}`,controlBefore=(await store.readFresh<ProjectControl>(prefix+'/control')).value;
 const budgetBefore=(await store.readFresh(prefix+'/budget')).value;
 const data=AudioExecutionSchema.parse((await store.readFresh(proof.audio.packageRef.key)).value);
 const loaded=await loadAudioExecution(store,proof.root,proof.projectId,proof.revisionId,proof.audio.packageRef,data.planRef,data.timingDraftRef);
 const plan=AudioPlanSchema.parse((await store.readFresh(data.planRef.key)).value);
 if(!loaded.package.tracks.voice.wav.silence||loaded.package.tracks.music.wav.silence)throw Error('REMIX_PROBE_REQUIRES_ACTUAL_MUSIC_AND_ZERO_VOICE');
 const root=await mkdtemp(resolve('.video-local/music-remix-')),digest=data.runtimeDigest;
 const env={VIDEO_MEDIA_IMAGE_REF:'sha256:'+digest,VIDEO_MEDIA_RUNTIME_DIGEST:digest,VIDEO_MEDIA_TIMEOUT_SECONDS:'180'};
 let networkCalls=0;const originalFetch=globalThis.fetch;globalThis.fetch=async()=>{networkCalls++;throw Error('REMIX_NETWORK_FORBIDDEN')};
 try{
  const paths={voice:join(root,'audio','archived','track.wav'),music:join(root,'sound',data.sound.stageKey,'output','music.wav'),foley:join(root,'sound',data.sound.stageKey,'output','foley.wav')};
  for(const bus of ['voice','music','foley'] as const){await mkdir(join(paths[bus],'..'),{recursive:true,mode:0o700});await frozenAudioInput(paths[bus],await readFile(join(proof.root,'objects',data.tracks[bus].audioRef.key)))}
  const voice=await inspectTrackWav(paths.voice,data.totalSamples,true),musicProbe=await inspectStereoTrackWav(paths.music,data.totalSamples,false),foley=await inspectStereoTrackWav(paths.foley,data.totalSamples,true);
  if(canonicalHash(voice)!==canonicalHash(data.tracks.voice.wav)||canonicalHash(musicProbe)!==canonicalHash(data.tracks.music.wav)||canonicalHash(foley)!==canonicalHash(data.tracks.foley.wav))throw Error('REMIX_INPUT_CHANGED');
  const narration={outputPath:paths.voice,runtimeDigest:digest,wav:voice,kind:'narration_only' as const,qaStatus:'not_checked' as const};
  const stems={...data.sound,runtimeDigest:digest,music:{outputPath:paths.music,wav:musicProbe},foley:{outputPath:paths.foley,wav:foley},qualityStatus:'listening_not_checked' as const};
  const baseline=await buildAudioMaster(root,plan,narration,stems,data.durationMs,data.fps,env);
  const modified=await buildAudioMaster(root,plan,narration,stems,data.durationMs,data.fps,env,{musicGainDb:-3});
  const replay=await buildAudioMaster(root,plan,narration,stems,data.durationMs,data.fps,env,{musicGainDb:-3});
  if(canonicalHash(replay)!==canonicalHash(modified)||baseline.stageKey===modified.stageKey||baseline.track.wav.sha256!==data.tracks.mix.wav.sha256)throw Error('REMIX_BASELINE_CHANGED');
  const original=pcm(await readFile(baseline.track.outputPath)),actual=pcm(await readFile(modified.track.outputPath)),music=pcm(await readFile(paths.music));
  const gain=10**(-3/20);let maxError=0,changedSamples=0;
  if(original.length!==actual.length||music.length!==actual.length)throw Error('REMIX_SAMPLE_COUNT_CHANGED');
  for(let offset=0;offset<actual.length;offset+=4){const expected=original.readFloatLE(offset)+(gain-1)*music.readFloatLE(offset),value=actual.readFloatLE(offset);maxError=Math.max(maxError,Math.abs(value-expected));if(value!==original.readFloatLE(offset))changedSamples++}
  if(maxError>0.000001||changedSamples===0||networkCalls)throw Error('REMIX_MUSIC_BUS_CHANGED');
  if(canonicalHash(controlBefore)!==canonicalHash((await store.readFresh(prefix+'/control')).value)||canonicalHash(budgetBefore)!==canonicalHash((await store.readFresh(prefix+'/budget')).value))throw Error('REMIX_SOURCE_CHANGED');
  const report={executedAt:new Date().toISOString(),status:'pass',sourceRoot:proof.root,root,projectId:proof.projectId,revisionId:proof.revisionId,packageRef:proof.audio.packageRef,runtimeDigest:digest,musicGainDb:-3,baseline,modified,replayIdentical:true,baselineMatchesArchivedMix:true,wholeFilmInterleavedSamples:actual.length/4,changedSamples,maxSampleError:maxError,networkCalls,sourceControlAndBudgetUnchanged:true,resultPublished:false,limits:'Actual archived model-generated music/foley with intentionally zero voice, trusted pinned offline Docker/FFmpeg. Exact whole-film float PCM comparison verifies music-only attenuation while other buses remain intact. This is not listening/loudness/post-mix ASR, a qualified result or the public natural-language change workflow.'};
  await writeFile('docs/engineering/evidence/music-remix-probe.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:'pass',musicGainDb:-3,changedSamples,maxSampleError:maxError,replayIdentical:true,networkCalls,resultPublished:false}));
 }finally{globalThis.fetch=originalFetch}
}
main().catch(error=>{console.error(error instanceof Error?error.message:'MUSIC_REMIX_FAILED');process.exitCode=1});
