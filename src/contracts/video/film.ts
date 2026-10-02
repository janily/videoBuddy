import{z}from'zod';
import{ObjectRefSchema}from'./domain';
import{quantizeCue}from'@/services/video/timeline/compile';
import{getStyle}from'@/services/video/styles/registry';
import{canonicalHash,canonicalJson}from'@/services/video/domain/hash';
import type{AtomicStore}from'@/services/video/storage/atomic-store';

const id=z.string().min(1).max(120),digest=z.string().regex(/^[a-f0-9]{64}$/),frame=z.number().int().nonnegative(),sample=z.number().int().nonnegative(),fps=z.union([z.literal(24),z.literal(30),z.literal(60)]);
const transition=z.strictObject({kind:z.enum(['cut','crossfade']),overlapFrames:frame});
const section=z.strictObject({id,startFrame:frame,endFrame:frame,bpm:z.number().positive().max(300),beatsPerBar:z.number().int().min(1).max(12),beatUnit:z.union([z.literal(2),z.literal(4),z.literal(8),z.literal(16)]),barOffset:z.number().int().nonnegative()});
const shot=z.strictObject({id,startFrame:frame,endFrame:frame,purpose:z.string().min(1),framing:z.string().min(1),camera:z.string().min(1),sourceModule:id,actorIds:z.array(id),transitionIn:transition,transitionOut:transition,factIds:z.array(id)});
const cue=z.strictObject({id,sourceShotId:id,requestedTimeUs:z.number().int().nonnegative(),alignmentPolicy:z.enum(['audio','frame']),resolvedFrame:frame,resolvedSample:sample,quantizationErrorUs:z.number().finite()});
const narration=z.strictObject({lineId:id,displayText:z.string().min(1),spokenText:z.string().min(1),expectedAsrText:z.string().min(1),voiceConfigHash:digest,audioRef:ObjectRefSchema,startSample:sample,endSample:sample,wordTimingsRef:ObjectRefSchema});
const sound=z.strictObject({eventId:id,cueId:id,source:id,pitch:z.number().positive().max(4).optional(),durationSamples:z.number().int().positive(),gainDb:z.number().min(-60).max(12),pan:z.number().min(-1).max(1)});
const caption=z.strictObject({id,lineId:id.optional(),text:z.string().min(1),startFrame:frame,endFrame:frame,stableReadableStartFrame:frame,styleRef:id,factIds:z.array(id)});
export const FilmTimelineSchema=z.strictObject({totalFrames:z.number().int().positive(),fps,sampleRate:z.literal(48000),sections:z.array(section).min(1),shots:z.array(shot).min(1),cues:z.array(cue),narration:z.array(narration),music:z.array(sound),foley:z.array(sound),captions:z.array(caption),intentionalBlackRanges:z.array(z.strictObject({startFrame:frame,endFrame:frame,reason:z.string().min(1)})),intentionalSilenceRanges:z.array(z.strictObject({startSample:sample,endSample:sample,buses:z.array(id).min(1)}))});
export type FilmTimeline=z.infer<typeof FilmTimelineSchema>;
export interface TimelineReferences{sourceModules:ReadonlySet<string>;actorIds:ReadonlySet<string>;factIds:ReadonlySet<string>;captionStyles:ReadonlySet<string>;audioSources:ReadonlySet<string>;audioBuses:ReadonlySet<string>}
export const FilmSpecSchema=z.strictObject({schemaVersion:z.literal(5),projectId:z.string().uuid(),revisionId:z.string().uuid(),briefVersion:z.number().int().nonnegative(),style:z.strictObject({slug:id,packVersion:id,upstreamCommit:z.string().regex(/^[a-f0-9]{40}$/)}),output:z.strictObject({width:z.number().int().positive(),height:z.number().int().positive(),fps,totalFrames:z.number().int().positive(),sampleRate:z.literal(48000)}),seed:z.number().int().nonnegative(),understandingRef:ObjectRefSchema,treatmentRef:ObjectRefSchema,factsRef:ObjectRefSchema,timelineRef:ObjectRefSchema,assetManifestRef:ObjectRefSchema,sourceManifestRef:ObjectRefSchema,audioManifestRef:ObjectRefSchema,runtimeDigest:digest,qualityPolicyVersion:id});
export type FilmSpec=z.infer<typeof FilmSpecSchema>;

function distinct(values:string[]){return new Set(values).size===values.length}
function covered(ranges:Array<{start:number;end:number}>,limit:number){let end=0;for(const range of ranges){if(range.start!==end||range.end<=range.start||range.end>limit)return false;end=range.end}return end===limit}
function contained(start:number,end:number,limit:number){return start<end&&end<=limit}
export function validateFilmTimeline(input:unknown,refs:TimelineReferences):FilmTimeline{
 const parsed=FilmTimelineSchema.safeParse(input);if(!parsed.success)throw Error('TIMELINE_INVALID');
 const value=parsed.data,totalFrames=value.totalFrames,totalSamples=totalFrames*48000/value.fps;
 if(!Number.isSafeInteger(totalSamples)||totalFrames<20*value.fps||totalFrames>120*value.fps||totalFrames%value.fps!==0)throw Error('TIMELINE_INVALID');
 if(!distinct(value.sections.map(x=>x.id))||!covered(value.sections.map(x=>({start:x.startFrame,end:x.endFrame})),totalFrames))throw Error('TIMELINE_COVERAGE');
 if(!distinct(value.shots.map(x=>x.id)))throw Error('TIMELINE_REFERENCE');
 const shots=value.shots;
 if(shots[0].startFrame!==0||shots.at(-1)!.endFrame!==totalFrames||shots[0].transitionIn.kind!=='cut'||shots[0].transitionIn.overlapFrames!==0||shots.at(-1)!.transitionOut.kind!=='cut'||shots.at(-1)!.transitionOut.overlapFrames!==0)throw Error('TIMELINE_COVERAGE');
 for(const [index,current]of shots.entries()){
  if(!contained(current.startFrame,current.endFrame,totalFrames))throw Error('TIMELINE_COVERAGE');
  if(!refs.sourceModules.has(current.sourceModule)||current.actorIds.some(actor=>!refs.actorIds.has(actor))||current.factIds.some(fact=>!refs.factIds.has(fact))||!distinct(current.actorIds)||!distinct(current.factIds))throw Error('TIMELINE_REFERENCE');
  if(index===0)continue;
  const previous=shots[index-1],overlap=previous.endFrame-current.startFrame;
  if(overlap<0||current.endFrame<=previous.endFrame)throw Error('TIMELINE_COVERAGE');
  if(index>=2&&current.startFrame<shots[index-2].endFrame)throw Error('TIMELINE_TRANSITION');
  if(overlap===0){if(previous.transitionOut.kind!=='cut'||current.transitionIn.kind!=='cut'||previous.transitionOut.overlapFrames!==0||current.transitionIn.overlapFrames!==0)throw Error('TIMELINE_TRANSITION')}
  else if(previous.transitionOut.kind!=='crossfade'||current.transitionIn.kind!=='crossfade'||previous.transitionOut.overlapFrames!==overlap||current.transitionIn.overlapFrames!==overlap||overlap>=previous.endFrame-previous.startFrame||overlap>=current.endFrame-current.startFrame)throw Error('TIMELINE_TRANSITION');
 }
 const shotById=new Map(shots.map(item=>[item.id,item]));
 if(!distinct(value.cues.map(x=>x.id)))throw Error('TIMELINE_REFERENCE');
 for(const item of value.cues){
  const source=shotById.get(item.sourceShotId);if(!source)throw Error('TIMELINE_REFERENCE');
  const requestedFrame=item.requestedTimeUs*value.fps/1000000;
  if(requestedFrame<source.startFrame||requestedFrame>=source.endFrame)throw Error('TIMELINE_AUDIO_RANGE');
  const expected=quantizeCue(item.requestedTimeUs,value.fps,item.alignmentPolicy);
  if(item.resolvedFrame!==expected.resolvedFrame||item.resolvedSample!==expected.resolvedSample||Math.abs(item.quantizationErrorUs-expected.quantizationErrorUs)>0.001||item.resolvedFrame>=totalFrames||item.resolvedSample>=totalSamples)throw Error('TIMELINE_QUANTIZATION');
 }
 const cueById=new Map(value.cues.map(item=>[item.id,item]));
 if(!distinct(value.narration.map(x=>x.lineId)))throw Error('TIMELINE_REFERENCE');
 const narrationById=new Map(value.narration.map(item=>[item.lineId,item]));
 for(const line of value.narration){if(!contained(line.startSample,line.endSample,totalSamples))throw Error('TIMELINE_AUDIO_RANGE');if(line.audioRef.mime!=='audio/wav'||line.wordTimingsRef.mime!=='application/json'||line.audioRef.bytes===0||line.wordTimingsRef.bytes===0)throw Error('TIMELINE_REFERENCE')}
 const ordered=[...value.narration].sort((a,b)=>a.startSample-b.startSample);for(let i=1;i<ordered.length;i++)if(ordered[i].startSample<ordered[i-1].endSample)throw Error('TIMELINE_AUDIO_RANGE');
 const events=[...value.music,...value.foley];if(!distinct(events.map(x=>x.eventId)))throw Error('TIMELINE_REFERENCE');
 for(const event of events){const at=cueById.get(event.cueId);if(!at||!refs.audioSources.has(event.source))throw Error('TIMELINE_REFERENCE');if(at.resolvedSample+event.durationSamples>totalSamples)throw Error('TIMELINE_AUDIO_RANGE')}
 if(!distinct(value.captions.map(x=>x.id)))throw Error('TIMELINE_REFERENCE');
 for(const item of value.captions){if(!contained(item.startFrame,item.endFrame,totalFrames)||item.stableReadableStartFrame<item.startFrame||item.stableReadableStartFrame>=item.endFrame)throw Error('TIMELINE_CAPTION_RANGE');if(item.lineId&&!narrationById.has(item.lineId)||!refs.captionStyles.has(item.styleRef)||item.factIds.some(fact=>!refs.factIds.has(fact))||!distinct(item.factIds))throw Error('TIMELINE_REFERENCE')}
 for(const range of value.intentionalBlackRanges)if(!contained(range.startFrame,range.endFrame,totalFrames))throw Error('TIMELINE_BLACK_RANGE');
 for(const range of value.intentionalSilenceRanges){if(!contained(range.startSample,range.endSample,totalSamples)||!distinct(range.buses))throw Error('TIMELINE_AUDIO_RANGE');if(range.buses.some(bus=>!refs.audioBuses.has(bus)))throw Error('TIMELINE_REFERENCE')}
 return value;
}
export function validateFilmSpec(input:unknown,timeline:unknown):FilmSpec{
 const parsed=FilmSpecSchema.safeParse(input),clock=FilmTimelineSchema.safeParse(timeline);if(!parsed.success||!clock.success)throw Error('FILM_SPEC_INVALID');
 const value=parsed.data,output=value.output,source=clock.data;
 let style;try{style=getStyle(value.style.slug)}catch{throw Error('FILM_SPEC_INVALID')}
 if(style.packVersion!==value.style.packVersion||style.upstreamCommit!==value.style.upstreamCommit||!(output.width===1920&&output.height===1080||output.width===1080&&output.height===1920)||output.totalFrames<20*output.fps||output.totalFrames>120*output.fps||output.totalFrames%output.fps!==0||source.totalFrames!==output.totalFrames||source.fps!==output.fps||source.sampleRate!==output.sampleRate)throw Error('FILM_SPEC_INVALID');
 const refs=[value.understandingRef,value.treatmentRef,value.factsRef,value.timelineRef,value.assetManifestRef,value.sourceManifestRef,value.audioManifestRef];
 if(refs.some(ref=>ref.mime!=='application/json'||ref.bytes===0)||!distinct(refs.map(ref=>ref.key)))throw Error('FILM_SPEC_INVALID');
 return value;
}
export async function verifyFilmPackageRefs(store:AtomicStore,input:unknown,timeline:unknown,refs:TimelineReferences):Promise<FilmSpec>{
 const verifiedTimeline=validateFilmTimeline(timeline,refs),spec=validateFilmSpec(input,verifiedTimeline);
 const entries=[['understanding',spec.understandingRef],['treatment',spec.treatmentRef],['facts',spec.factsRef],['timeline',spec.timelineRef],['assetManifest',spec.assetManifestRef],['sourceManifest',spec.sourceManifestRef],['audioManifest',spec.audioManifestRef]]as const;
 const revisionPrefix=`projects/${spec.projectId}/revisions/${spec.revisionId}/`;
 await Promise.all(entries.map(async([name,ref])=>{
  const prefix=name==='understanding'?`projects/${spec.projectId}/understanding/`:revisionPrefix;
  if(!ref.key.startsWith(prefix))throw Error('FILM_REF_CHANGED');
  let value:unknown;try{value=(await store.readFresh<unknown>(ref.key)).value}catch{throw Error('FILM_REF_CHANGED')}
  if(canonicalHash(value)!==ref.sha256||Buffer.byteLength(canonicalJson(value))!==ref.bytes||name==='timeline'&&canonicalHash(verifiedTimeline)!==ref.sha256)throw Error('FILM_REF_CHANGED');
 }));
 return spec;
}
