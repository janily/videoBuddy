import {findConfirmedPostMixReview} from '@/services/video/audio/postmix-review';
import {createHash} from 'node:crypto';
import {isAbsolute,join} from 'node:path';
import type {ObjectRef,Understanding} from '@/contracts/video/domain';
import type {ProjectControl} from '@/contracts/video/project';
import type {VerifiedNarrationManifest} from '@/services/video/audio/asr';
import type {NarrationPlan} from '@/services/video/audio/narration';
import {verifyPostMixNoNarration,verifyPostMixNarration} from '@/services/video/audio/postmix-asr';
import {formatSrt,readPinnedSubtitleFont,type SubtitleCue} from '@/services/video/audio/subtitles';
import {inspectTrackWav} from '@/services/video/audio/wav';
import {loadAudioExecution} from '@/services/video/audio/execution-package';
import type {CompositionTrack} from '@/services/video/audio/master';
import {AudioPlanSchema} from '@/contracts/video/audio-plan';
import {prepareAudioPlanStage} from './audio-plan-stage';
import {prepareAudioExecutionStage} from './audio-execution-stage';
import type {Environment} from '@/services/video/config/environment';
import {canonicalHash,canonicalJson} from '@/services/video/domain/hash';
import {composeStageKey,composeVideo,type CaptionStyle} from '@/services/video/media/compose';
import {dockerConfiguration} from '@/services/video/media/docker-executor';
import {technicalVideoQa} from '@/services/video/media/technical-qa';
import {createOrRead,StoreMissing} from '@/services/video/storage/atomic-store';
import type {ProjectStore} from '@/services/video/storage/project-store';
import {assertPreviewProductionFence} from './fence';
import {preparePictureSequenceStage} from './picture-sequence-stage';
import {TimingDraftSchema} from './timing-draft';
import {prepareTimingStage} from './timing-stage';
import {prepareVoiceStage} from './voice-stage';
import {prepareNarrationPackageStage} from './narration-package-stage';
import {captionStyleForProfile} from '@/services/video/timeline/package';

type Profile='full'|'preview'|'probe';
type Qa=typeof technicalVideoQa;
type Compose=typeof composeVideo;
type PostMix=typeof verifyPostMixNarration;
type Font=typeof readPinnedSubtitleFont;
interface Options{root?:string;env?:Environment;profile?:Profile;pictureQa?:Qa;filmQa?:Qa;compose?:Compose;postMix?:PostMix;readFont?:Font;mustExist?:boolean}
export interface CompositeStageRecord{
 schemaVersion:4;audioPlanSha256:string;audioExecutionSha256:string|null;briefVersion:number;treatmentSha256:string;timingDraftSha256:string;pictureSequenceHash:string;voiceVerifiedSha256:string;narrationPackageSha256:string;
 profile:Profile;stageKey:string;outputPath:string;captionStyle:CaptionStyle|null;technicalQa:Awaited<ReturnType<Qa>>;
 loudness:Awaited<ReturnType<Compose>>['loudness'];postMix:Awaited<ReturnType<PostMix>>|Awaited<ReturnType<typeof verifyPostMixNoNarration>>;qualityStatus:'semantic_not_checked';
}

async function readRef<T>(projects:ProjectStore,ref:ObjectRef,prefix:string):Promise<T>{
 if(ref.mime!=='application/json'||ref.bytes<1||!ref.key.startsWith(prefix))throw Error('COMPOSITE_REF_CHANGED');
 let value:T;try{value=(await projects.store.readFresh<T>(ref.key)).value}catch{throw Error('COMPOSITE_REF_CHANGED')}
 if(canonicalHash(value)!==ref.sha256||Buffer.byteLength(canonicalJson(value))!==ref.bytes)throw Error('COMPOSITE_REF_CHANGED');
 return value;
}

export async function prepareCompositeStage(projects:ProjectStore,projectId:string,revisionId:string,operationId:string,expectedConsentEpoch:number,treatmentRef:ObjectRef,options:Options={}):Promise<CompositeStageRecord>{
 const env=options.env||process.env,root=options.root||env.VIDEO_DATA_DIR,profile=options.profile||'full';
 if(!root||!isAbsolute(root)||!['full','preview','probe'].includes(profile))throw Error('CONFIGURATION_REQUIRED: VIDEO_DATA_DIR');
 const dataRoot=root;
 const prefix=`projects/${projectId}`,revisionPrefix=`${prefix}/revisions/${revisionId}/`;
 const control=(await projects.store.readFresh<ProjectControl>(`${prefix}/control`)).value;
 assertPreviewProductionFence(control,projectId,operationId,expectedConsentEpoch);
 const understanding=await readRef<Understanding>(projects,control.understandingRef,`${prefix}/understanding/`);
 const voice=await prepareVoiceStage(projects,projectId,revisionId,operationId,expectedConsentEpoch,treatmentRef,{root,env,mustExist:true});
 const [originalPlan,verified]=await Promise.all([readRef<NarrationPlan>(projects,voice.planRef,revisionPrefix),readRef<VerifiedNarrationManifest>(projects,voice.verifiedRef,revisionPrefix)]);
 const timingRecord=await prepareTimingStage(projects,projectId,revisionId,operationId,expectedConsentEpoch,treatmentRef,{root,env,mustExist:true});
 const timing=TimingDraftSchema.parse(await readRef<unknown>(projects,timingRecord.draftRef,revisionPrefix));
 const narrationPackage=await prepareNarrationPackageStage(projects,projectId,revisionId,operationId,expectedConsentEpoch,treatmentRef,{root,env,mustExist:options.mustExist});
 const picture=await preparePictureSequenceStage(projects,projectId,revisionId,operationId,expectedConsentEpoch,treatmentRef,{root,env,profile,qa:options.pictureQa,mustExist:options.mustExist});
 const landscape=understanding.preferences.aspect==='16:9',width=profile==='probe'?(landscape?320:180):profile==='preview'?(landscape?1280:720):(landscape?1920:1080),height=profile==='probe'?(landscape?180:320):profile==='preview'?(landscape?720:1280):(landscape?1080:1920);
 const config=dockerConfiguration(env,operationId),wav=await inspectTrackWav(timing.track.outputPath,timing.durationMs*48,timing.track.silence);
 if(wav.sha256!==timing.track.sha256||wav.samples!==timing.track.samples||timing.track.runtimeDigest!==config.runtimeDigest)throw Error('COMPOSITE_TRACK_CHANGED');
 const audio=await prepareAudioPlanStage(projects,projectId,revisionId,operationId,expectedConsentEpoch,treatmentRef,{root,env,mustExist:true});
 const plan=AudioPlanSchema.parse(await readRef<unknown>(projects,audio.planRef,revisionPrefix+'audio-plan/'));
 let executionRef:ObjectRef|null=null;
 try{executionRef=(await prepareAudioExecutionStage(projects,projectId,revisionId,operationId,expectedConsentEpoch,treatmentRef,{root,env,mustExist:true})).packageRef}
 catch(error){if((error as Error).message!=='AUDIO_EXECUTION_MISSING')throw error;if(plan.music.length||plan.foley.length||plan.mix.voiceGainDb!==0)throw Error('COMPOSITE_AUDIO_EXECUTION_NOT_READY')}
 const execution=executionRef?await loadAudioExecution(projects.store,root,projectId,revisionId,executionRef,audio.planRef,timingRecord.draftRef):null;
 const track:CompositionTrack=execution?execution.track:{outputPath:timing.track.outputPath,runtimeDigest:timing.track.runtimeDigest,wav,kind:'narration_only',qaStatus:'not_checked'};
 const masterWav=track.wav;
 const audioPlanSha256=audio.planRef.sha256,audioExecutionSha256=executionRef?.sha256||null;
 const cues:SubtitleCue[]=timing.captions.map(cue=>({...cue,startMs:Math.round(cue.startFrame*1000/timing.fps),endMs:Math.round(cue.endFrame*1000/timing.fps)}));
 if(Boolean(cues.length)!==Boolean(timing.font)||cues.length&&understanding.preferences.captions!=='auto'||!cues.length&&understanding.preferences.captions==='auto'&&verified.lines.length>0)throw Error('COMPOSITE_CAPTION_CHANGED');
 if(timing.font){
  const font=await (options.readFont||readPinnedSubtitleFont)(env);
  if(font.family!==timing.font.family||font.runtimeDigest!==timing.font.runtimeDigest||font.charsetSha256!==timing.font.charsetSha256||cues.some(cue=>[...cue.text].some(char=>!/\s/.test(char)&&!font.glyphs.has(char))))throw Error('COMPOSITE_FONT_CHANGED');
 }
 const captionStyle:CaptionStyle|null=cues.length?captionStyleForProfile(profile):null;
 const bundleHash=canonicalHash({projectId,revisionId,treatmentSha256:treatmentRef.sha256,timingDraftSha256:timingRecord.draftRef.sha256,pictureSequenceHash:canonicalHash(picture),voiceVerifiedSha256:voice.verifiedRef.sha256,narrationPackageSha256:narrationPackage.packageRef.sha256,audioPlanSha256,audioExecutionSha256});
 const spec={width,height,durationSec:timing.durationMs/1000,fps:timing.fps,bundleHash,fence:expectedConsentEpoch};
 const srt=formatSrt(cues),srtSha256=srt?createHash('sha256').update(srt).digest('hex'):null;
 const stageKey=composeStageKey({pictureSha256:picture.technicalQa.sha256,trackSha256:masterWav.sha256,trackSilent:masterWav.silence,srtSha256,style:captionStyle,runtimeDigest:config.runtimeDigest,spec});
 const stageDir=join(root,'composition',stageKey),outputPath=join(stageDir,'output','final.mp4'),key=`${revisionPrefix}composite-v4/${profile}`,qa=options.filmQa||technicalVideoQa;
 const postMixOptions={assertActive:async()=>{
  const latest=(await projects.store.readFresh<ProjectControl>(`${prefix}/control`)).value;
  assertPreviewProductionFence(latest,projectId,operationId,expectedConsentEpoch,{briefVersion:control.briefVersion,understandingRef:control.understandingRef});
 },journal:{store:projects.store,prefix:`${prefix}/operations/${operationId}/media-effects`},resolveReview:(context:Parameters<typeof findConfirmedPostMixReview>[2])=>findConfirmedPostMixReview(projects.store,projectId,context)};
 const expected={width,height,durationSec:timing.durationMs/1000,fps:timing.fps,audio:true,...(masterWav.channels===2?{audioChannels:2 as const}:{})};
 async function verify(record:CompositeStageRecord,checkPostMix=true){
  if(record.schemaVersion!==4||record.audioPlanSha256!==audioPlanSha256||record.audioExecutionSha256!==audioExecutionSha256||record.briefVersion!==control.briefVersion||record.treatmentSha256!==treatmentRef.sha256||record.timingDraftSha256!==timingRecord.draftRef.sha256||record.pictureSequenceHash!==canonicalHash(picture)||record.voiceVerifiedSha256!==voice.verifiedRef.sha256||record.narrationPackageSha256!==narrationPackage.packageRef.sha256||record.profile!==profile||record.stageKey!==stageKey||record.outputPath!==outputPath||canonicalHash(record.captionStyle)!==canonicalHash(captionStyle)||record.qualityStatus!=='semantic_not_checked'||record.postMix.filmSha256!==record.technicalQa.sha256||record.loudness.filmSha256!==record.technicalQa.sha256)throw Error('COMPOSITE_STAGE_CONFLICT');
  const actual=await qa(stageDir,config.image,'output/final.mp4',expected);
  if(canonicalHash(actual)!==canonicalHash(record.technicalQa))throw Error('COMPOSITE_OUTPUT_CHANGED');
  if(checkPostMix){
   const film={outputPath,sha256:actual.sha256,durationMs:timing.durationMs,technicalQa:'pass' as const};
   const recovered=executionRef&&verified.lines.length===0&&!masterWav.silence?await verifyPostMixNoNarration(projects.store,dataRoot,film,projectId,revisionId,executionRef,audio.planRef,timingRecord.draftRef):await (options.postMix||verifyPostMixNarration)(dataRoot,film,originalPlan,verified,env,undefined,{...postMixOptions,mustExist:true});
   if(canonicalHash(recovered)!==canonicalHash(record.postMix))throw Error('COMPOSITE_POSTMIX_CHANGED');
  }
  await postMixOptions.assertActive();
  return record;
 }
 try{return await verify((await projects.store.readFresh<CompositeStageRecord>(key)).value)}catch(error){if(!(error instanceof StoreMissing))throw error}
 if(options.mustExist)throw Error('COMPOSITE_STAGE_MISSING');
 const composed=await (options.compose||composeVideo)(root,join(root,'picture-sequence',picture.stageKey),track,cues,captionStyle,spec,env);
 if(composed.stageKey!==stageKey||composed.outputPath!==outputPath||composed.qaStatus!=='semantic_not_checked'||composed.technicalQa.audio!==true||composed.technicalQa.frames!==timing.totalFrames||composed.loudness.status!==(masterWav.silence?'not_applicable':'pass'))throw Error('COMPOSITE_OUTPUT_INVALID');
 const actual=await qa(stageDir,config.image,'output/final.mp4',expected);
 if(canonicalHash(actual)!==canonicalHash(composed.technicalQa))throw Error('COMPOSITE_OUTPUT_CHANGED');
 const film={outputPath,sha256:actual.sha256,durationMs:timing.durationMs,technicalQa:'pass' as const};
 const postMix=executionRef&&verified.lines.length===0&&!masterWav.silence?await verifyPostMixNoNarration(projects.store,root,film,projectId,revisionId,executionRef,audio.planRef,timingRecord.draftRef):await (options.postMix||verifyPostMixNarration)(root,film,originalPlan,verified,env,undefined,postMixOptions);
 if(postMix.filmSha256!==actual.sha256||postMix.status!==(verified.lines.length===0?'not_applicable':'pass')||postMix.lines.length!==verified.lines.length)throw Error('COMPOSITE_POSTMIX_FAILED');
 const latest=(await projects.store.readFresh<ProjectControl>(`${prefix}/control`)).value;
 assertPreviewProductionFence(latest,projectId,operationId,expectedConsentEpoch,{briefVersion:control.briefVersion,understandingRef:control.understandingRef});
 const record:CompositeStageRecord={schemaVersion:4,audioPlanSha256,audioExecutionSha256,briefVersion:control.briefVersion,treatmentSha256:treatmentRef.sha256,timingDraftSha256:timingRecord.draftRef.sha256,pictureSequenceHash:canonicalHash(picture),voiceVerifiedSha256:voice.verifiedRef.sha256,narrationPackageSha256:narrationPackage.packageRef.sha256,profile,stageKey,outputPath,captionStyle,technicalQa:actual,loudness:composed.loudness,postMix,qualityStatus:'semantic_not_checked'};
 const stored=await createOrRead(projects.store,key,record);
 if(canonicalHash(stored)!==canonicalHash(record))throw Error('COMPOSITE_STAGE_CONFLICT');
 return verify(stored,false);
}
