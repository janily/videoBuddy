import {z} from 'zod';
import type {ExcerptSegment} from './excerpt';
import {validatePreviewSegments,validatePreviewSpeechCoverage} from './render-excerpt';
const frame=z.number().int().nonnegative();
const clockSchema=z.object({fps:z.union([z.literal(24),z.literal(30),z.literal(60)]),totalFrames:frame.max(7200),shots:z.array(z.object({id:z.string().min(1),startFrame:frame,endFrame:frame,factIds:z.array(z.string())})).min(1).max(80),narration:z.array(z.object({startSample:frame,endSample:frame})).max(120),captions:z.array(z.object({startFrame:frame,endFrame:frame})).max(120)});
// Excerpts copy actual source ranges. They never fabricate a sample movie or
// truncate a spoken sentence/subtitle reading window to meet a duration target.
export function selectPreviewExcerpt(raw:unknown,criticalFactIds:string[]):ExcerptSegment[]{
 const parsed=clockSchema.safeParse(raw);if(!parsed.success)throw Error('PREVIEW_EXCERPT_INVALID');const clock=parsed.data;
 let end=0;const ids=new Set<string>();for(const shot of clock.shots){if(shot.startFrame!==end||shot.endFrame<=end||shot.endFrame>clock.totalFrames||ids.has(shot.id))throw Error('PREVIEW_EXCERPT_INVALID');end=shot.endFrame;ids.add(shot.id)}if(end!==clock.totalFrames)throw Error('PREVIEW_EXCERPT_INVALID');
 const durationMs=clock.totalFrames*1000/clock.fps,critical=new Set(criticalFactIds),gcd=(a:number,b:number):number=>b?gcd(b,a%b):a,step=clock.fps/gcd(clock.fps,1000);
 const windows=[...clock.narration.map(line=>({startMs:line.startSample/48,endMs:line.endSample/48})),...clock.captions.map(cue=>({startMs:cue.startFrame*1000/clock.fps,endMs:cue.endFrame*1000/clock.fps}))];
 if(windows.some(w=>w.endMs<=w.startMs||w.endMs>durationMs))throw Error('PREVIEW_EXCERPT_INVALID');
 const candidates:Array<{shotId:string;start:number;end:number;score:number}>=[];
 for(const shot of clock.shots){
  const start=Math.ceil(shot.startFrame/step)*step,last=Math.floor(shot.endFrame/step)*step,score=shot.factIds.filter(id=>critical.has(id)).length;
  const ranges:number[][]=[[start,last]];
  // Bounded frame-grid search finds safe gaps away from three fixed landmarks.
  for(const seconds of [6,9,12])for(let first=start;first+seconds*clock.fps<=last;first+=step)ranges.push([first,first+seconds*clock.fps]);
  // Whole native sentences may last e.g. 7.5s, not one of the target durations.
  const boundaries=new Set([start,last]);
  for(const window of windows)for(const ms of [window.startMs,window.endMs]){
   const position=ms*clock.fps/1000;
   for(const value of [Math.floor(position/step)*step,Math.ceil(position/step)*step])if(value>=start&&value<=last)boundaries.add(value);
  }
  for(const first of boundaries)for(const final of boundaries)if(final>first&&final-first<=clock.fps*12)ranges.push([first,final]);
  for(const [first,final] of ranges){
   if(final<=first||final-first>clock.fps*12||first<start||final>last)continue;const startMs=first*1000/clock.fps,endMs=final*1000/clock.fps;
   if(windows.some(w=>w.startMs<endMs&&w.endMs>startMs&&(w.startMs<startMs||w.endMs>endMs)))continue;
   candidates.push({shotId:shot.id,start:startMs,end:endMs,score});
  }
 }
 const unitMs=step*1000/clock.fps,maxUnits=12000/unitMs;
 type Choice={count:number;units:number;score:number;ranges:typeof candidates};
 let states=new Map<number,Choice>([[0,{count:0,units:0,score:0,ranges:[]}]]);
 // Bounded knapsack retains smaller combinations instead of getting stuck
 // after five tiny high-priority shots. One range per shot, at most five.
 for(const shot of clock.shots){
  const durations=new Map<number,(typeof candidates)[number]>();
  for(const candidate of candidates)if(candidate.shotId===shot.id){const units=(candidate.end-candidate.start)/unitMs;const old=durations.get(units);if(!old||candidate.start<old.start)durations.set(units,candidate)}
  const next=new Map(states);
  for(const state of states.values())for(const [units,candidate] of durations){
   const total=state.units+units,count=state.count+1;if(count>5||total>maxUnits)continue;
   const key=count*(maxUnits+1)+total,score=state.score+candidate.score,old=next.get(key);
   if(!old||score>old.score)next.set(key,{count,units:total,score,ranges:[...state.ranges,candidate]});
  }
  states=next;
 }
 const best=[...states.values()].filter(state=>state.units*unitMs>=6000).sort((a,b)=>b.score-a.score||Math.abs(a.units*unitMs-9000)-Math.abs(b.units*unitMs-9000))[0];
 if(!best)throw Error('PREVIEW_EXCERPT_UNAVAILABLE');const chosen=best.ranges;
 chosen.sort((a,b)=>a.start-b.start);let cursor=0;
 const segments=chosen.map(item=>{const segment={previewStartMs:cursor,previewEndMs:cursor+item.end-item.start,sourceStartMs:item.start,sourceEndMs:item.end,shotId:item.shotId};cursor=segment.previewEndMs;return segment});
 validatePreviewSegments(segments,durationMs,clock.fps);validatePreviewSpeechCoverage(segments,windows,durationMs);return segments;
}
