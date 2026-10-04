import {join} from 'node:path';
import type {ProjectStore} from '@/services/video/storage/project-store';
import type {Environment} from '@/services/video/config/environment';
import {createOrRead,StoreMissing} from '@/services/video/storage/atomic-store';
import {canonicalHash} from '@/services/video/domain/hash';
import {CaptionPackageSchema} from '@/contracts/video/film-package';
import {TimingDraftSchema} from '@/services/video/preview/timing-draft';
import {compileVoicePlan} from '@/services/video/preview/voice-plan';
import {readNarrationJson,loadPackagedNarration} from '@/services/video/audio/narration-package';
import {asrConfiguration,type VerifiedNarrationManifest} from '@/services/video/audio/asr';
import {verifyPostMixNarration,verifyPostMixNoNarration} from '@/services/video/audio/postmix-asr';
import {composeVideo,type CaptionStyle} from '@/services/video/media/compose';
import {technicalVideoQa} from '@/services/video/media/technical-qa';
import {assertApprovedRenderFence,loadApprovedRenderInputs,type ApprovedRenderInputs} from './approved-inputs';
import {renderApprovedPictures} from './pictures';

// Reconstruct the verification input from archived actual WAV/ASR evidence,
// rather than mutable working voice directories or a new synthesis call.
async function archivedNarration(projects:ProjectStore,root:string,inputs:ApprovedRenderInputs){
 const {frozen,projectId,bundle}=inputs,plan=compileVoicePlan(frozen.treatmentPlan,frozen.understanding);
 const lines:VerifiedNarrationManifest['lines']=[];
 for(const line of plan.lines){
  const entry=frozen.audioManifest.sources.find(source=>source.id==='voice-'+line.lineId);if(!entry)throw Error('FILM_NARRATION_CHANGED');
  const {source,words}=await loadPackagedNarration(projects.store,root,projectId,bundle.revisionId,entry.sourceRef);
  lines.push({...line,durationMs:source.wav.durationMs,voice:{lineId:line.lineId,...source.voiceConfig,outputPath:join(root,'objects',source.audioRef.key),wav:source.wav},asrStatus:words.speechReview?'trusted_review':'pass',...(words.speechReview?{speechReview:words.speechReview}:{}),wordTimingsStatus:'available',asr:{model:words.asrModel,runtimeDigest:words.asrRuntimeDigest,voiceSha256:words.voiceSha256},recognizedText:words.recognizedText,wordTimings:words.words});
 }
 return{plan,verified:{durationMs:plan.durationMs,lines}};
}
export async function composeApprovedFilm(projects:ProjectStore,owner:string,projectId:string,operationId:string,expectedFence:number,options:{root:string;env?:Environment;mustExist?:boolean}){
 const {root}=options,env=options.env||process.env,inputs=await loadApprovedRenderInputs(projects,owner,projectId,operationId,expectedFence,{root,env}),{frozen}=inputs;
 const key=`projects/${projectId}/approvals/${inputs.approval.approvalId}/composite-v2-stage`;
 if(options.mustExist){try{await projects.store.readFresh(key)}catch(error){if(error instanceof StoreMissing)throw Error('RENDER_STAGE_MISSING');throw error}}
 const track=frozen.filmAudioTrack,executionRef=frozen.audioManifest.executionRef;
 if(!track||!executionRef)throw Error('APPROVED_AUDIO_NOT_READY');
 if(frozen.timeline.narration.length)asrConfiguration(env);
 const prefix=`projects/${projectId}/revisions/${inputs.bundle.revisionId}/`,timing=TimingDraftSchema.parse(await readNarrationJson(projects.store,frozen.audioManifest.timingDraftRef,prefix));
 const cues=timing.captions.map(cue=>({...cue,startMs:Math.round(cue.startFrame*1000/timing.fps),endMs:Math.round(cue.endFrame*1000/timing.fps)}));
 let style:CaptionStyle|null=null;
 if(cues.length){const entry=frozen.sourceManifest.captionStyles[0];if(!entry)throw Error('FILM_CAPTION_CHANGED');style=CaptionPackageSchema.parse(await readNarrationJson(projects.store,entry.styleRef,prefix)).profiles.full}
 const {plan,verified}=await archivedNarration(projects,root,inputs);
 const journal={store:projects.store,prefix:`projects/${projectId}/operations/${operationId}/media-effects`};
 const picture=await renderApprovedPictures(projects,owner,projectId,operationId,expectedFence,{root,env,mustExist:options.mustExist});
 const {width,height,fps,totalFrames}=frozen.filmSpec.output,durationSec=totalFrames/fps;
 await assertApprovedRenderFence(projects,inputs);
 const movie=await composeVideo(root,join(root,'picture-sequence',picture.sequence.stageKey),track,cues,style,{width,height,fps,durationSec,bundleHash:inputs.bundle.bundleHash,fence:inputs.approval.consentEpoch},env,{producerReceipt:true,mustExist:options.mustExist,assertActive:()=>assertApprovedRenderFence(projects,inputs),journal});
 const actual=await technicalVideoQa(join(root,'composition',movie.stageKey),'sha256:'+frozen.filmSpec.runtimeDigest,'output/final.mp4',{width,height,fps,durationSec,audio:true,audioChannels:track.wav.channels});
 if(canonicalHash(actual)!==canonicalHash(movie.technicalQa)||movie.loudness.filmSha256!==actual.sha256)throw Error('RENDER_OUTPUT_CHANGED');
 const film={outputPath:movie.outputPath,sha256:actual.sha256,durationMs:durationSec*1000,technicalQa:'pass' as const};
 await assertApprovedRenderFence(projects,inputs);
 const postMix=!verified.lines.length&&!track.wav.silence?await verifyPostMixNoNarration(projects.store,root,film,projectId,inputs.bundle.revisionId,executionRef,frozen.audioManifest.planRef,frozen.audioManifest.timingDraftRef):await verifyPostMixNarration(root,film,plan,verified,env,undefined,{mustExist:options.mustExist,assertActive:()=>assertApprovedRenderFence(projects,inputs),journal});
 const record={schemaVersion:2 as const,inputHash:inputs.inputHash,pictureStageHash:canonicalHash(picture),audioExecutionSha256:executionRef.sha256,movie,postMix,qualityStatus:'semantic_not_checked' as const,deliveryEligible:false as const};
 let previous:typeof record|undefined;try{previous=(await projects.store.readFresh<typeof record>(key)).value}catch(error){if(!(error instanceof StoreMissing))throw error}
 if(previous&&canonicalHash(previous)!==canonicalHash(record))throw Error('RENDER_OUTPUT_CHANGED');
 const latest=await loadApprovedRenderInputs(projects,owner,projectId,operationId,expectedFence,{root,env});
 if(latest.inputHash!==inputs.inputHash)throw Error('RENDER_FENCED');
 const saved=await createOrRead(projects.store,key,record);if(canonicalHash(saved)!==canonicalHash(record))throw Error('RENDER_STAGE_CONFLICT');return record;
}
