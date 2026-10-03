import {readFile,writeFile,realpath} from 'node:fs/promises';
import {resolve,relative,isAbsolute,dirname} from 'node:path';
import type {ProjectControl} from '../../src/contracts/video/project';
import type {ObjectRef,Understanding} from '../../src/contracts/video/domain';
import {AudioPlanSchema} from '../../src/contracts/video/audio-plan';
import {FileStore} from '../../src/services/video/storage/file-store';
import {ProjectStore} from '../../src/services/video/storage/project-store';
import {prepareAudioPlanStage} from '../../src/services/video/preview/audio-plan-stage';
import {buildSoundStems} from '../../src/services/video/audio/sound';
import {buildAudioMaster} from '../../src/services/video/audio/master';
import {inspectTrackWav} from '../../src/services/video/audio/wav';
import {composeVideo} from '../../src/services/video/media/compose';
import {TimingDraftSchema} from '../../src/services/video/preview/timing-draft';
import {canonicalHash} from '../../src/services/video/domain/hash';
import {probeEnvironment} from './helpers/real-probe';
async function main(){
 if(!process.argv.includes('--compose'))throw Error('NATIVE_COMPOSITION_PROBE_OPT_IN_REQUIRED');
 const creation=JSON.parse(await readFile('docs/engineering/evidence/real-creation-no-voice-probe.json','utf8')),pictures=JSON.parse(await readFile('docs/engineering/evidence/real-picture-probe.json','utf8')),audio=JSON.parse(await readFile('docs/engineering/evidence/real-audio-repair-probe.json','utf8'));
 const root=await realpath(creation.root),rel=relative(await realpath(resolve('.video-local/real-creation')),root);
 if(!rel||rel.startsWith('..')||isAbsolute(rel)||pictures.root!==root||audio.root!==root||pictures.status!=='pass'||audio.status!=='pass')throw Error('NATIVE_COMPOSITION_BASELINE_REQUIRED');
 const projects=new ProjectStore(new FileStore(root)),{projectId,revisionId,operationId}=creation.stages.project,env=probeEnvironment(root),treatmentRef=creation.stages.treatment.treatmentRef as ObjectRef;
 const control=(await projects.store.readFresh<ProjectControl>('projects/'+projectId+'/control')).value,understanding=(await projects.store.readFresh<Understanding>(control.understandingRef.key)).value;
 if(understanding.preferences.voiceMode!=='none')throw Error('NATIVE_COMPOSITION_VOICE_INTENT_CHANGED');
 const savedFetch=globalThis.fetch;globalThis.fetch=async()=>{throw Error('NATIVE_COMPOSITION_NETWORK_FORBIDDEN')};
 try{
  const audioStage=await prepareAudioPlanStage(projects,projectId,revisionId,operationId,0,treatmentRef,{root,env,mustExist:true}),plan=AudioPlanSchema.parse((await projects.store.readFresh(audioStage.planRef.key)).value),timing=TimingDraftSchema.parse((await projects.store.readFresh(creation.stages.timing.draftRef.key)).value);
  if(canonicalHash(plan)!==canonicalHash(audio.plan)||timing.narration.length||timing.captions.length)throw Error('NATIVE_COMPOSITION_BASELINE_CHANGED');
  const wav=await inspectTrackWav(timing.track.outputPath,960000,true);
  if(wav.sha256!==timing.track.sha256||wav.peakDbfs!==null||plan.sources.some(source=>source.kind!=='synthesis'))throw Error('NATIVE_COMPOSITION_VOICE_BUS_NOT_SILENT');
  const narration={outputPath:timing.track.outputPath,runtimeDigest:timing.track.runtimeDigest,wav,kind:'narration_only' as const,qaStatus:'not_checked' as const};
  const stems=await buildSoundStems(root,plan,20000,timing.fps,env),master=await buildAudioMaster(root,plan,narration,stems,20000,timing.fps,env);
  const spec={width:1280,height:720,durationSec:20,fps:timing.fps,bundleHash:canonicalHash({picture:pictures.sequence.technicalQa.sha256,plan:audioStage.planRef.sha256,master:master.track.wav.sha256}),fence:0};
  const composed=await composeVideo(root,dirname(dirname(pictures.sequence.outputPath)),master.track,[],null,spec,env);
  const replay=await composeVideo(root,dirname(dirname(pictures.sequence.outputPath)),master.track,[],null,spec,env);
  if(composed.technicalQa.sha256!==replay.technicalQa.sha256)throw Error('NATIVE_COMPOSITION_REPLAY_CHANGED');
  const evidence={executedAt:new Date().toISOString(),root,projectId,revisionId,actualModelVisualAndAudio:true,additionalModelCalls:0,audioPlanSha256:audioStage.planRef.sha256,musicEvents:plan.music.length,foleyEvents:plan.foley.length,sourceCount:plan.sources.length,stems:{music:stems.music.wav,foley:stems.foley.wav},master:master.track.wav,outputPath:composed.outputPath,technicalQa:composed.technicalQa,loudness:composed.loudness,replayIdentical:true,voiceAsrApplicability:{status:'not_applicable',reason:'Explicit no-narration test variant; frozen voice PCM is exactly zero and all non-voice sources are deterministic synthesis. Spoken-name test remains blocked, no voice or listening quality claim.'},qualityStatus:'semantic_not_checked',limits:'Actual native Treatment/Visual/Audio data rendered and composed in pinned offline runtimes, 720p/20s, synthetic voices not substituted. Not yet integrated AudioExecution/FilmSpec/preview worker/UI, no 1080p formal render, listening/semantic/style QA or 43-style baseline.'};
  await writeFile('docs/engineering/evidence/native-composition-probe.json',JSON.stringify(evidence,null,2)+'\n');console.log(JSON.stringify({status:'pass',technicalQa:evidence.technicalQa,loudness:evidence.loudness,musicEvents:evidence.musicEvents,foleyEvents:evidence.foleyEvents,additionalModelCalls:0}));
 }finally{globalThis.fetch=savedFetch}
}
main().catch(error=>{console.error(JSON.stringify({status:'fail',errorName:error?.name||'Error',errorCode:String(error?.message||'NATIVE_COMPOSITION_FAILED').replaceAll(process.env.MODEL_API_KEY||'missing-key','[redacted]').slice(0,300)}));process.exitCode=1});
