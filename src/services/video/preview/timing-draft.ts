import {LegacyTimingFontSchema,BookTimingFontSchema,type BookTimingFont} from '../audio/book-font';
import {hasVerifiedNarrationStatus} from '@/services/video/audio/asr';
import {z} from 'zod';
import type {Understanding} from '@/contracts/video/domain';
import {guardTreatment} from '@/contracts/video/treatment';
import type {VerifiedNarrationManifest} from '@/services/video/audio/asr';
import type {NarrationPlan} from '@/services/video/audio/narration';
import type {NarrationTrack} from '@/services/video/audio/mix';
import type {SubtitleCue} from '@/services/video/audio/subtitles';
import {canonicalHash} from '@/services/video/domain/hash';
import {getStyle} from '@/services/video/styles/registry';
import {compileVoicePlan} from './voice-plan';

const digest=z.string().regex(/^[a-f0-9]{64}$/),frame=z.number().int().nonnegative(),sample=z.number().int().nonnegative(),text=z.string().min(1);
export const TimingDraftSchema=z.strictObject({schemaVersion:z.literal(1),briefVersion:z.number().int().nonnegative(),styleSlug:text,styleRulesHash:digest,durationMs:z.number().int().min(20000).max(120000),totalFrames:frame,fps:z.union([z.literal(24),z.literal(30),z.literal(60)]),sampleRate:z.literal(48000),
 shots:z.array(z.strictObject({id:text,startFrame:frame,endFrame:frame,visualIntent:text,factIds:z.array(text)})).min(1),
 narration:z.array(z.strictObject({lineId:text,spokenText:text,displayText:text,expectedAsrText:text,startSample:sample,endSample:sample,voiceSha256:digest,voiceRuntimeDigest:digest,asrRuntimeDigest:digest})),
 captions:z.array(z.strictObject({lineId:text,text,startFrame:frame,endFrame:frame,voiceSha256:digest})),
 track:z.strictObject({outputPath:text,sha256:digest,samples:sample,runtimeDigest:digest,silence:z.boolean()}),
 font:z.union([LegacyTimingFontSchema,BookTimingFontSchema]).nullable(),
 qualityStatus:z.literal('semantic_not_checked')});
export type TimingDraft=z.infer<typeof TimingDraftSchema>;
export type TimingFont={family:'Noto Sans CJK SC';runtimeDigest:string;charsetSha256:string}|BookTimingFont;

export function compileTimingDraft(rawTreatment:unknown,understanding:Understanding,voicePlan:NarrationPlan,verified:VerifiedNarrationManifest,cues:SubtitleCue[],track:NarrationTrack,font:TimingFont|null):TimingDraft{
 if(!understanding.preferences.styleSlug)throw Error('TREATMENT_BASELINE_CHANGED');
 const treatment=guardTreatment(rawTreatment,understanding,getStyle(understanding.preferences.styleSlug).rulesHash);
 if(canonicalHash(voicePlan)!==canonicalHash(compileVoicePlan(treatment,understanding))||verified.durationMs!==voicePlan.durationMs||verified.lines.length!==voicePlan.lines.length)throw Error('TIMING_VOICE_PLAN_CHANGED');
 const totalFrames=treatment.durationSec*treatment.fps,totalSamples=treatment.durationSec*48000;
 if(track.kind!=='narration_only'||track.qaStatus!=='not_checked'||track.wav.sampleRate!==48000||track.wav.samples!==totalSamples||track.wav.durationMs!==treatment.durationSec*1000||track.wav.silence!==(verified.lines.length===0)||!digest.safeParse(track.wav.sha256).success||!digest.safeParse(track.runtimeDigest).success)throw Error('TIMING_TRACK_INVALID');
 const narration:TimingDraft['narration']=[];
 for(const [index,line] of verified.lines.entries()){
  const expected=voicePlan.lines[index];
  if(line.lineId!==expected.lineId||line.spokenText!==expected.spokenText||line.displayText!==expected.displayText||line.expectedAsrText!==expected.expectedAsrText||line.startMs!==expected.startMs||line.reservedMs!==expected.reservedMs||line.language!==expected.language||!hasVerifiedNarrationStatus(line)||line.wordTimingsStatus!=='available'||line.asr?.voiceSha256!==line.voice.wav.sha256||line.wordTimings.length===0||line.voice.wav.sampleRate!==24000||line.voice.wav.samples<=0||line.voice.wav.durationMs!==line.durationMs)throw Error('TIMING_VOICE_PLAN_CHANGED');
  const startSample=line.startMs*48,endSample=startSample+line.voice.wav.samples*2;
  if(!Number.isSafeInteger(startSample)||!Number.isSafeInteger(endSample)||endSample>totalSamples||line.durationMs>line.reservedMs)throw Error('TIMING_AUDIO_RANGE');
  narration.push({lineId:line.lineId,spokenText:line.spokenText,displayText:line.displayText,expectedAsrText:line.expectedAsrText,startSample,endSample,voiceSha256:line.voice.wav.sha256,voiceRuntimeDigest:line.voice.runtimeDigest,asrRuntimeDigest:line.asr.runtimeDigest});
 }
 if((understanding.preferences.captions==='none'&&cues.length!==0)||(understanding.preferences.captions==='auto'&&cues.length!==verified.lines.length)||Boolean(cues.length)!==Boolean(font))throw Error('TIMING_CAPTION_INVALID');
 if(font?.family==='Crayon Book Handwriting'&&treatment.styleSlug!=='crayon-book')throw Error('TIMING_CAPTION_INVALID');
 if(font&&(font.runtimeDigest!==track.runtimeDigest||!digest.safeParse(font.charsetSha256).success))throw Error('TIMING_CAPTION_INVALID');
 const lines=new Map(verified.lines.map(line=>[line.lineId,line]));let captionEnd=0;
 const captions=cues.map(cue=>{
  const line=lines.get(cue.lineId);
  if(!line||cue.voiceSha256!==line.voice.wav.sha256||cue.text!==line.displayText)throw Error('TIMING_CAPTION_SOURCE_CHANGED');
  if(cue.startFrame<captionEnd||cue.startFrame<0||cue.endFrame<=cue.startFrame||cue.endFrame>totalFrames||cue.startMs!==Math.round(cue.startFrame*1000/treatment.fps)||cue.endMs!==Math.round(cue.endFrame*1000/treatment.fps)||cue.startFrame!==Math.floor(line.startMs*treatment.fps/1000))throw Error('TIMING_CAPTION_INVALID');
  captionEnd=cue.endFrame;
  return{lineId:cue.lineId,text:cue.text,startFrame:cue.startFrame,endFrame:cue.endFrame,voiceSha256:cue.voiceSha256};
 });
 const draft={schemaVersion:1 as const,briefVersion:treatment.briefVersion,styleSlug:treatment.styleSlug,styleRulesHash:treatment.styleRulesHash,durationMs:treatment.durationSec*1000,totalFrames,fps:treatment.fps,sampleRate:48000 as const,
  shots:treatment.shots.map(shot=>({id:shot.id,startFrame:shot.startFrame,endFrame:shot.endFrame,visualIntent:shot.visualIntent,factIds:shot.factIds})),narration,captions,track:{outputPath:track.outputPath,sha256:track.wav.sha256,samples:track.wav.samples,runtimeDigest:track.runtimeDigest,silence:track.wav.silence},font:font?(font.family==='Crayon Book Handwriting'?BookTimingFontSchema.parse(font):{family:font.family,runtimeDigest:font.runtimeDigest,charsetSha256:font.charsetSha256}):null,qualityStatus:'semantic_not_checked' as const};
 const parsed=TimingDraftSchema.safeParse(draft);if(!parsed.success)throw Error('TIMING_DRAFT_INVALID');
 return parsed.data;
}
