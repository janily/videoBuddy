import {z} from 'zod';
import type {Understanding} from './domain';
import {FilmTimelineSchema,type FilmTimeline} from './film';
import {guardTreatment} from './treatment';
import {TimingDraftSchema,type TimingDraft} from '@/services/video/preview/timing-draft';
import {canonicalHash} from '@/services/video/domain/hash';
import {getStyle} from '@/services/video/styles/registry';
import {quantizeCue} from '@/services/video/timeline/compile';

const id=z.string().min(1).max(120),digest=z.string().regex(/^[a-f0-9]{64}$/),text=z.string().min(1).max(3000);
const source=z.discriminatedUnion('kind',[
 z.strictObject({id,kind:z.literal('synthesis'),description:text,material:text,recipe:z.strictObject({instrument:z.enum(['sine','triangle','pluck','noise']),frequencyHz:z.number().min(30).max(12000),attackMs:z.number().min(0).max(2000),releaseMs:z.number().min(0).max(5000)})}),
 z.strictObject({id,kind:z.literal('user_track'),description:text,assetId:z.uuid()}),
]);
export const AudioPlanSchema=z.strictObject({schemaVersion:z.literal(1),briefVersion:z.number().int().nonnegative(),styleSlug:id,styleRulesHash:digest,timingDraftHash:digest,seed:z.number().int().min(0).max(0xffffffff),sections:FilmTimelineSchema.shape.sections.max(80),
 cues:z.array(z.strictObject({id,sourceShotId:id,requestedTimeUs:z.number().int().nonnegative(),alignmentPolicy:z.enum(['audio','frame'])})).max(1000),sources:z.array(source).max(160),music:FilmTimelineSchema.shape.music.max(800),foley:FilmTimelineSchema.shape.foley.max(800),intentionalSilenceRanges:FilmTimelineSchema.shape.intentionalSilenceRanges.max(160),
 mix:z.strictObject({targetLufs:z.literal(-14),toleranceLu:z.literal(1),maxTruePeakDbtp:z.literal(-1.2),voiceGainDb:z.number().min(-24).max(12),duck:z.strictObject({thresholdDb:z.number().min(-45).max(-1),ratio:z.number().min(1).max(12),attackMs:z.number().min(1).max(100),releaseMs:z.number().min(20).max(1000)})}),reasoning:text});
export type AudioPlan=z.infer<typeof AudioPlanSchema>;
export function compileAudioCues(plan:AudioPlan,fps:24|30|60):FilmTimeline['cues']{
 return plan.cues.map(cue=>({...cue,...quantizeCue(cue.requestedTimeUs,fps,cue.alignmentPolicy)}));
}
function unique(ids:string[]){return new Set(ids).size===ids.length}

export function guardAudioPlan(raw:unknown,understanding:Understanding,rawTreatment:unknown,rawTiming:TimingDraft,expectedTimingHash:string,expectedSeed:number):AudioPlan{
 const parsed=AudioPlanSchema.safeParse(raw),timed=TimingDraftSchema.safeParse(rawTiming);
 if(!parsed.success||!timed.success)throw Error('AUDIO_PLAN_INVALID');
 if(!understanding.preferences.styleSlug)throw Error('AUDIO_BASELINE_CHANGED');
 const style=getStyle(understanding.preferences.styleSlug),treatment=guardTreatment(rawTreatment,understanding,style.rulesHash),plan=parsed.data,timing=timed.data;
 if(canonicalHash(timing)!==expectedTimingHash||plan.timingDraftHash!==expectedTimingHash||plan.seed!==expectedSeed||plan.briefVersion!==understanding.briefVersion||plan.styleSlug!==style.slug||plan.styleRulesHash!==style.rulesHash||timing.briefVersion!==treatment.briefVersion||timing.styleRulesHash!==style.rulesHash||timing.fps!==treatment.fps||timing.durationMs!==treatment.durationSec*1000||timing.totalFrames!==treatment.durationSec*treatment.fps||canonicalHash(timing.shots)!==canonicalHash(treatment.shots.map(({id,startFrame,endFrame,visualIntent,factIds})=>({id,startFrame,endFrame,visualIntent,factIds}))))throw Error('AUDIO_BASELINE_CHANGED');
 let end=0;
 if(!unique(plan.sections.map(section=>section.id)))throw Error('AUDIO_TIMELINE_INVALID');
 for(const section of plan.sections){if(section.startFrame!==end||section.endFrame<=section.startFrame||section.endFrame>timing.totalFrames)throw Error('AUDIO_TIMELINE_INVALID');end=section.endFrame}
 if(end!==timing.totalFrames)throw Error('AUDIO_TIMELINE_INVALID');
 const sources=new Map(plan.sources.map(source=>[source.id,source])),shots=new Map(treatment.shots.map(shot=>[shot.id,shot])),cues=compileAudioCues(plan,treatment.fps),byCue=new Map(cues.map(cue=>[cue.id,cue])),events=[...plan.music,...plan.foley],totalSamples=timing.durationMs*48;
 if(!unique(plan.sources.map(source=>source.id))||!unique(plan.cues.map(cue=>cue.id))||!unique(events.map(event=>event.eventId)))throw Error('AUDIO_EVENT_INVALID');
 for(const cue of cues){const shot=shots.get(cue.sourceShotId),requested=cue.requestedTimeUs*treatment.fps/1e6;if(!shot||requested<shot.startFrame||requested>=shot.endFrame||cue.resolvedFrame>=timing.totalFrames||cue.resolvedSample>=totalSamples)throw Error('AUDIO_EVENT_INVALID')}
 for(const event of events){
  const cue=byCue.get(event.cueId),source=sources.get(event.source);
  if(!cue||!source||cue.resolvedSample+event.durationSamples>totalSamples||source.kind==='synthesis'&&(source.recipe.frequencyHz*(event.pitch||1)>20000||(source.recipe.attackMs+source.recipe.releaseMs)*48>event.durationSamples))throw Error('AUDIO_EVENT_INVALID');
 }
 if(plan.sources.some(source=>!events.some(event=>event.source===source.id))||plan.cues.some(cue=>!events.some(event=>event.cueId===cue.id)))throw Error('AUDIO_EVENT_INVALID');
 const mode=understanding.preferences.musicMode;
 if(mode==='none'&&plan.music.length||mode!=='none'&&plan.music.length===0||mode==='composed'&&plan.music.some(event=>sources.get(event.source)?.kind!=='synthesis')||mode==='user_track'&&plan.music.some(event=>{const source=sources.get(event.source);return source?.kind!=='user_track'||source.assetId!==understanding.preferences.musicAssetId}))throw Error('AUDIO_MUSIC_INTENT_CHANGED');
 for(const source of plan.sources)if(source.kind==='user_track'&&(!understanding.assetUses.some(use=>use.assetId===source.assetId)||source.assetId!==understanding.preferences.musicAssetId||mode!=='user_track'))throw Error('AUDIO_ASSET_INVALID');
 for(const range of plan.intentionalSilenceRanges){
  if(range.endSample<=range.startSample||range.endSample>totalSamples||!unique(range.buses)||range.buses.some(bus=>!['music','foley'].includes(bus)))throw Error('AUDIO_SILENCE_INVALID');
  for(const bus of range.buses)for(const event of bus==='music'?plan.music:plan.foley){const cue=byCue.get(event.cueId)!;if(cue.resolvedSample<range.endSample&&cue.resolvedSample+event.durationSamples>range.startSample)throw Error('AUDIO_SILENCE_INVALID')}
 }
 return plan;
}
