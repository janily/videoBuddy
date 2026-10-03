import {mkdtemp,mkdir,readFile,rm,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {FileStore} from '../../src/services/video/storage/file-store';
import {ProjectStore} from '../../src/services/video/storage/project-store';
import {AudioExecutionSchema,loadAudioExecution,archiveAudioExecution} from '../../src/services/video/audio/execution-package';
import {AudioPlanSchema} from '../../src/contracts/video/audio-plan';
import {TimingDraftSchema} from '../../src/services/video/preview/timing-draft';
import {buildSoundStems,frozenAudioInput} from '../../src/services/video/audio/sound';
import {buildAudioMaster} from '../../src/services/video/audio/master';
import {inspectTrackWav} from '../../src/services/video/audio/wav';
import {readMusicGainBaseline,resolveMusicGain} from '../../src/services/video/revisions/music-gain';
import {canonicalHash} from '../../src/services/video/domain/hash';
async function main(){
 if(!process.argv.includes('--gain-package'))throw Error('MUSIC_GAIN_PACKAGE_OPT_IN_REQUIRED');
 const proof=JSON.parse(await readFile('docs/engineering/evidence/native-package-probe.json','utf8')),source=new FileStore(proof.root),prefix=`projects/${proof.projectId}`;
 const controlBefore=(await source.readFresh(prefix+'/control')).value,budgetBefore=(await source.readFresh(prefix+'/budget')).value;
 const data=AudioExecutionSchema.parse((await source.readFresh(proof.audio.packageRef.key)).value);
 const original=await readMusicGainBaseline(source,proof.root,proof.projectId,proof.revisionId,proof.audio.packageRef,data.planRef,data.timingDraftRef);
 const loaded=await loadAudioExecution(source,proof.root,proof.projectId,proof.revisionId,proof.audio.packageRef,data.planRef,data.timingDraftRef);
 if(!loaded.package.tracks.voice.wav.silence||original.musicGainDb!==0)throw Error('GAIN_PROBE_REQUIRES_ORIGINAL_ZERO_GAIN_AND_ZERO_VOICE');
 const originalPlan=AudioPlanSchema.parse((await source.readFresh(data.planRef.key)).value),originalTiming=TimingDraftSchema.parse((await source.readFresh(data.timingDraftRef.key)).value);
 const root=await mkdtemp(resolve('.video-local/music-gain-package-')),projects=new ProjectStore(new FileStore(root)),revisionPrefix=prefix+`/revisions/${proof.revisionId}/`;
 const env={VIDEO_MEDIA_IMAGE_REF:'sha256:'+data.runtimeDigest,VIDEO_MEDIA_RUNTIME_DIGEST:data.runtimeDigest,VIDEO_MEDIA_TIMEOUT_SECONDS:'180'};
 let networkCalls=0;const fetchBefore=globalThis.fetch;globalThis.fetch=async()=>{networkCalls++;throw Error('GAIN_PROBE_NETWORK_FORBIDDEN')};
 try{
  const voicePath=join(root,'audio','archived','track.wav');await mkdir(join(voicePath,'..'),{recursive:true,mode:0o700});await frozenAudioInput(voicePath,await readFile(join(proof.root,'objects',data.tracks.voice.audioRef.key)));
  const voiceWav=await inspectTrackWav(voicePath,data.totalSamples,true);if(canonicalHash(voiceWav)!==canonicalHash(data.tracks.voice.wav))throw Error('GAIN_PROBE_VOICE_CHANGED');
  // Relocate only the disposable voice path. Musical recipe, timing, seed and
  // events remain the archived model output; reexecute deterministic tools offline.
  const timing={...originalTiming,track:{...originalTiming.track,outputPath:voicePath}},timingRef=await projects.index.immutable(revisionPrefix+'timing-draft',timing);
  const plan={...originalPlan,timingDraftHash:timingRef.sha256},planRef=await projects.index.immutable(revisionPrefix+'audio-plan',plan);
  const stems=await buildSoundStems(root,plan,data.durationMs,data.fps,env);
  if(stems.music.wav.sha256!==data.tracks.music.wav.sha256||stems.foley.wav.sha256!==data.tracks.foley.wav.sha256)throw Error('GAIN_PROBE_SOUND_CHANGED');
  const voice={outputPath:voicePath,runtimeDigest:data.runtimeDigest,wav:voiceWav,kind:'narration_only' as const,qaStatus:'not_checked' as const};
  const baseline=await buildAudioMaster(root,plan,voice,stems,data.durationMs,data.fps,env);
  if(baseline.track.wav.sha256!==data.tracks.mix.wav.sha256)throw Error('GAIN_PROBE_DEFAULT_MIX_CHANGED');
  const resolved=resolveMusicGain(original.musicGainDb,{field:'musicGainDb',value:-3,valueMode:'relative'});
  const modified=await buildAudioMaster(root,plan,voice,stems,data.durationMs,data.fps,env,{musicGainDb:resolved.musicGainDb});
  const packageRef=await archiveAudioExecution(projects,root,proof.projectId,proof.revisionId,planRef,timingRef,voice,stems,modified);
  const before=await loadAudioExecution(projects.store,root,proof.projectId,proof.revisionId,packageRef,planRef,timingRef);
  const gain=await readMusicGainBaseline(projects.store,root,proof.projectId,proof.revisionId,packageRef,planRef,timingRef);
  if(before.package.schemaVersion!==3||gain.musicGainDb!==-3||gain.trackSha256.music!==original.trackSha256.music||gain.trackSha256.foley!==original.trackSha256.foley||gain.trackSha256.voice!==original.trackSha256.voice)throw Error('GAIN_PROBE_PACKAGE_CHANGED');
  const second=resolveMusicGain(gain.musicGainDb,{field:'musicGainDb',value:-3,valueMode:'relative'});if(second.musicGainDb!==-6)throw Error('GAIN_PROBE_RELATIVE_CHANGED');
  let outsideRange='';try{resolveMusicGain(gain.musicGainDb,{field:'musicGainDb',value:-6,valueMode:'relative'})}catch(error){outsideRange=error instanceof Error?error.message:''}if(outsideRange!=='CHANGE_PREVIEW_REQUIRED')throw Error('GAIN_PROBE_RANGE_NOT_REJECTED');
  const forged=await projects.index.immutable(revisionPrefix+'audio-execution',{...before.package,master:{...before.package.master,musicGainDb:-4}});
  let tamperRejected=false;try{await loadAudioExecution(projects.store,root,proof.projectId,proof.revisionId,forged,planRef,timingRef)}catch(error){tamperRejected=error instanceof Error&&error.message==='AUDIO_EXECUTION_CHANGED'}if(!tamperRejected)throw Error('GAIN_PROBE_TAMPER_NOT_REJECTED');
  for(const dir of ['audio','sound','audio-master'])await rm(join(root,dir),{recursive:true});
  const cold=await loadAudioExecution(new FileStore(root),root,proof.projectId,proof.revisionId,packageRef,planRef,timingRef);if(canonicalHash(cold)!==canonicalHash(before))throw Error('GAIN_PROBE_COLD_CHANGED');
  if(networkCalls||canonicalHash(controlBefore)!==canonicalHash((await source.readFresh(prefix+'/control')).value)||canonicalHash(budgetBefore)!==canonicalHash((await source.readFresh(prefix+'/budget')).value))throw Error('GAIN_PROBE_SOURCE_CHANGED');
  const report={executedAt:new Date().toISOString(),status:'pass',sourceRoot:proof.root,root,projectId:proof.projectId,revisionId:proof.revisionId,sourcePackageRef:proof.audio.packageRef,packageRef,planRef,timingRef,runtimeDigest:data.runtimeDigest,original,resolved,gain,secondRelativeGain:second,outsideRange,tamperRejected,coldReplayIdentical:true,workingDirectoriesRemoved:true,originalStemsIdentical:true,originalDefaultMixIdentical:true,sourceControlAndBudgetUnchanged:true,networkCalls,resultPublished:false,qualityStatus:'listening_not_checked',limits:'Actual archived model-generated music/foley with intentional zero voice. Pinned network-disabled Docker regenerates identical stems/default mix and produces the -3dB master. Package/read/hash/producer receipts and cold reuse are verified; not a qualified movie, listening/loudness/postmix ASR, source-new-revision construction, owner authorization or public change execution.'};
  await writeFile('docs/engineering/evidence/music-gain-package-probe.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:'pass',musicGainDb:gain.musicGainDb,packageVersion:before.package.schemaVersion,secondRelativeGain:second.musicGainDb,coldReplayIdentical:true,networkCalls,resultPublished:false}));
 }finally{globalThis.fetch=fetchBefore}
}
main().catch(error=>{console.error(error instanceof Error?error.message:'MUSIC_GAIN_PACKAGE_PROBE_FAILED');process.exitCode=1});
