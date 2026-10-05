import {readBookTimingFont,assertBookCaptionGlyphs,isBookTimingFont} from '../audio/book-font';
import {recordBookFontReceipt} from '../audio/book-font-receipt';
import type {TimingFont} from './timing-draft';
import {isAbsolute,join,relative} from 'node:path';
import {z} from 'zod';
import type {ObjectRef,Understanding} from '@/contracts/video/domain';
import type {ProjectControl} from '@/contracts/video/project';
import {guardTreatment} from '@/contracts/video/treatment';
import type {VerifiedNarrationManifest} from '@/services/video/audio/asr';
import type {NarrationPlan} from '@/services/video/audio/narration';
import {buildNarrationTrack,type NarrationTrack} from '@/services/video/audio/mix';
import {compileSubtitles,readPinnedSubtitleFont} from '@/services/video/audio/subtitles';
import {inspectTrackWav} from '@/services/video/audio/wav';
import type {Environment} from '@/services/video/config/environment';
import {canonicalHash,canonicalJson} from '@/services/video/domain/hash';
import {createOrRead,StoreMissing} from '@/services/video/storage/atomic-store';
import type {ProjectStore} from '@/services/video/storage/project-store';
import {getStyle} from '@/services/video/styles/registry';
import {assertPreviewProductionFence} from './fence';
import {compileTimingDraft,TimingDraftSchema,type TimingDraft} from './timing-draft';
import {prepareVoiceStage,type VoiceStageRecord} from './voice-stage';

type FontResult=Awaited<ReturnType<typeof readPinnedSubtitleFont>>;
interface Options{root?:string;env?:Environment;buildTrack?:(root:string,verified:VerifiedNarrationManifest)=>Promise<NarrationTrack>;readFont?:()=>Promise<FontResult>;mustExist?:boolean}
export interface TimingStageRecord{schemaVersion:1;briefVersion:number;understandingSha256:string;treatmentSha256:string;voiceStageHash:string;draftRef:ObjectRef}

async function readRef<T>(projects:ProjectStore,ref:ObjectRef,prefix:string):Promise<T>{
 if(ref.mime!=='application/json'||ref.bytes<1||!ref.key.startsWith(prefix))throw Error('TIMING_REF_CHANGED');
 let value:T;try{value=(await projects.store.readFresh<T>(ref.key)).value}catch{throw Error('TIMING_REF_CHANGED')}
 try{if(canonicalHash(value)!==ref.sha256||Buffer.byteLength(canonicalJson(value))!==ref.bytes)throw Error('TIMING_REF_CHANGED')}catch{throw Error('TIMING_REF_CHANGED')}
 return value;
}
async function assertTrack(root:string,draft:TimingDraft){
 const path=draft.track.outputPath,inside=relative(join(root,'audio'),path);
 if(!isAbsolute(path)||!inside||inside.startsWith('..')||isAbsolute(inside))throw Error('TIMING_TRACK_CHANGED');
 let actual;try{actual=await inspectTrackWav(path,draft.durationMs*48,draft.track.silence)}catch{throw Error('TIMING_TRACK_CHANGED')}
 if(actual.sha256!==draft.track.sha256||actual.samples!==draft.track.samples||actual.silence!==draft.track.silence)throw Error('TIMING_TRACK_CHANGED');
}

export async function prepareTimingStage(projects:ProjectStore,projectId:string,revisionId:string,operationId:string,expectedConsentEpoch:number,treatmentRef:ObjectRef,options:Options={}):Promise<TimingStageRecord>{
 if(![projectId,revisionId,operationId].every(id=>z.uuid().safeParse(id).success)||!Number.isSafeInteger(expectedConsentEpoch)||expectedConsentEpoch<0)throw Error('VALIDATION_FAILED');
 const prefix=`projects/${projectId}`,revisionPrefix=`${prefix}/revisions/${revisionId}/`,control=(await projects.store.readFresh<ProjectControl>(`${prefix}/control`)).value;
 assertPreviewProductionFence(control,projectId,operationId,expectedConsentEpoch);
 const env=options.env||process.env,root=options.root||env.VIDEO_DATA_DIR;
 if(!root||!isAbsolute(root))throw Error('CONFIGURATION_REQUIRED: VIDEO_DATA_DIR');
 const understanding=await readRef<Understanding>(projects,control.understandingRef,`${prefix}/understanding/`);
 if(understanding.briefVersion!==control.briefVersion||!treatmentRef.key.startsWith(`${revisionPrefix}treatment-plan/`))throw Error('TIMING_REF_CHANGED');
 const treatment=await readRef<unknown>(projects,treatmentRef,revisionPrefix);
 if(!understanding.preferences.styleSlug)throw Error('TREATMENT_BASELINE_CHANGED');
 const treatmentPlan=guardTreatment(treatment,understanding,getStyle(understanding.preferences.styleSlug).rulesHash);
 const voiceRecord:VoiceStageRecord=await prepareVoiceStage(projects,projectId,revisionId,operationId,expectedConsentEpoch,treatmentRef,{root,env,mustExist:true});
 const [voicePlan,verified]=await Promise.all([readRef<NarrationPlan>(projects,voiceRecord.planRef,revisionPrefix),readRef<VerifiedNarrationManifest>(projects,voiceRecord.verifiedRef,revisionPrefix)]);
 const voiceStageHash=canonicalHash(voiceRecord),key=`${revisionPrefix}timing-stage`;
 let existing:TimingStageRecord|undefined;
 try{existing=(await projects.store.readFresh<TimingStageRecord>(key)).value}catch(error){if(!(error instanceof StoreMissing))throw error}
 if(existing){
  if(existing.schemaVersion!==1||existing.briefVersion!==control.briefVersion||existing.understandingSha256!==control.understandingRef.sha256||existing.treatmentSha256!==treatmentRef.sha256||existing.voiceStageHash!==voiceStageHash)throw Error('TIMING_STAGE_CONFLICT');
  const draft=TimingDraftSchema.parse(await readRef<unknown>(projects,existing.draftRef,revisionPrefix));
  await assertTrack(root,draft);
  const latest=(await projects.store.readFresh<ProjectControl>(`${prefix}/control`)).value;
  assertPreviewProductionFence(latest,projectId,operationId,expectedConsentEpoch,{briefVersion:control.briefVersion,understandingRef:control.understandingRef});
  return existing;
 }
 if(options.mustExist)throw Error('TIMING_STAGE_MISSING');
 const track=await (options.buildTrack||((dir,manifest)=>buildNarrationTrack(dir,manifest,env)))(root,verified);
 let font:TimingFont|null=null,glyphs=new Set<string>();
 if(understanding.preferences.captions==='auto'&&verified.lines.length){
  if(treatmentPlan.styleSlug==='crayon-book'&&!options.readFont){
   const installed=await readBookTimingFont(env,{version:2,assertActive:async()=>assertPreviewProductionFence((await projects.store.readFresh<ProjectControl>(`${prefix}/control`)).value,projectId,operationId,expectedConsentEpoch,{briefVersion:control.briefVersion,understandingRef:control.understandingRef}),journal:{store:projects.store,prefix:`${prefix}/operations/${operationId}/media-effects`}});
   assertBookCaptionGlyphs(verified.lines.map(line=>line.displayText),installed.glyphsById,2);font=installed.font;glyphs=new Set([...installed.glyphsById.values()].flatMap(chars=>[...chars]));
   await recordBookFontReceipt(projects.store,installed.font);
  }else{const installed=await (options.readFont||(()=>readPinnedSubtitleFont(env)))();font={family:installed.family,runtimeDigest:installed.runtimeDigest,charsetSha256:installed.charsetSha256};glyphs=installed.glyphs}
 }
 const cues=font?compileSubtitles(verified,treatmentPlan.fps,glyphs,{revealMs:isBookTimingFont(font)?350:0}):[];
 const draft=compileTimingDraft(treatment,understanding,voicePlan,verified,cues,track,font);
 await assertTrack(root,draft);
 const latest=(await projects.store.readFresh<ProjectControl>(`${prefix}/control`)).value;
 assertPreviewProductionFence(latest,projectId,operationId,expectedConsentEpoch,{briefVersion:control.briefVersion,understandingRef:control.understandingRef});
 const record:TimingStageRecord={schemaVersion:1,briefVersion:control.briefVersion,understandingSha256:control.understandingRef.sha256,treatmentSha256:treatmentRef.sha256,voiceStageHash,draftRef:await projects.index.immutable(`${revisionPrefix}timing-draft`,draft)};
 const stored=await createOrRead(projects.store,key,record);
 if(canonicalHash(stored)!==canonicalHash(record))throw Error('TIMING_STAGE_CONFLICT');
 return record;
}
