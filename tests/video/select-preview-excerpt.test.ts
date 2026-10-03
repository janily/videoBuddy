import {expect,it} from 'vitest';
import {selectPreviewExcerpt} from '@/services/video/preview/select-excerpt';
import {validatePreviewSegments,validatePreviewSpeechCoverage} from '@/services/video/preview/render-excerpt';
const clock={fps:24 as const,totalFrames:480,shots:[{id:'opening',startFrame:0,endFrame:120,factIds:[]},{id:'date',startFrame:120,endFrame:240,factIds:['date']},{id:'place',startFrame:240,endFrame:360,factIds:['place']},{id:'ending',startFrame:360,endFrame:480,factIds:[]}],narration:[],captions:[]};
it('selects real frozen shot ranges prioritizing critical facts, with a continuous 6–12 second preview clock',()=>{
 const segments=selectPreviewExcerpt(clock,['date','place']);expect(segments.map(segment=>segment.shotId)).toEqual(['date','place']);
 expect(validatePreviewSegments(segments,20000,24).durationMs).toBe(10000);expect(segments[0].sourceStartMs).toBe(5000);expect(segments[1].previewStartMs).toBe(5000);
});
it('never cuts a spoken sentence or caption reading window at either excerpt edge',()=>{
 const narration=[{startSample:1000*48,endSample:7500*48}],captions=[{startFrame:24,endFrame:204}];
 const segments=selectPreviewExcerpt({...clock,narration,captions},[]);
 validatePreviewSpeechCoverage(segments,narration.map(line=>({startMs:line.startSample/48,endMs:line.endSample/48})),20000);
 expect(segments.every(segment=>segment.sourceStartMs!>=8500)).toBe(true);
});
it('refuses a continuous long narration when no 6–12 second speech-safe range exists',()=>{
 expect(()=>selectPreviewExcerpt({...clock,shots:[{id:'long',startFrame:0,endFrame:480,factIds:[]}],narration:[{startSample:0,endSample:960000}]},[])).toThrow('PREVIEW_EXCERPT_UNAVAILABLE');
});
it('aligns source milliseconds and frame boundaries for arbitrary native shot boundaries',()=>{
 const segments=selectPreviewExcerpt({...clock,shots:[{id:'a',startFrame:0,endFrame:121,factIds:[]},{id:'b',startFrame:121,endFrame:251,factIds:[]},{id:'c',startFrame:251,endFrame:480,factIds:[]}]},[]);
 for(const segment of segments){expect(Number.isInteger(segment.sourceStartMs)).toBe(true);expect(Number.isInteger(segment.sourceStartMs!*24/1000)).toBe(true);expect(Number.isInteger(segment.sourceEndMs!*24/1000)).toBe(true)}
 expect(validatePreviewSegments(segments,20000,24).durationMs).toBeGreaterThanOrEqual(6000);
});
it.each([{narration:[{startSample:48,endSample:24001}],captions:[]},{narration:[],captions:[{startFrame:121,endFrame:200}]}])('preserves exact fractional sample/frame windows without truncating their edges (%j)',windows=>{
 const segments=selectPreviewExcerpt({...clock,...windows},[]);expect(validatePreviewSegments(segments,20000,24).durationMs).toBeGreaterThanOrEqual(6000);
});
it('respects the renderer five-segment limit for a valid rapid-cut film',()=>{
 const shots=Array.from({length:6},(_,i)=>({id:'short-'+i,startFrame:i*48,endFrame:(i+1)*48,factIds:['fact-'+i]}));shots.push({id:'ending',startFrame:288,endFrame:480,factIds:[]});
 const segments=selectPreviewExcerpt({...clock,shots},Array.from({length:6},(_,i)=>'fact-'+i));expect(segments.length).toBeLessThanOrEqual(5);expect(validatePreviewSegments(segments,20000,24).durationMs).toBeGreaterThanOrEqual(6000);
});
it('does not round away a fractional speech edge lying just outside an excerpt',()=>{
 const segments=[{previewStartMs:0,previewEndMs:6000,sourceStartMs:1000,sourceEndMs:7000,shotId:'unit'}];
 expect(()=>validatePreviewSpeechCoverage(segments,[{startMs:1000-1/48,endMs:3000}],20000)).toThrow('EXCERPT_SPEECH_CUT');
 expect(()=>validatePreviewSpeechCoverage(segments,[{startMs:5000,endMs:7000+1/48}],20000)).toThrow('EXCERPT_SPEECH_CUT');
});
it('finds a whole middle sentence that the opening/midpoint/ending heuristic misses',()=>{
 const narration=[{startSample:0,endSample:3000*48},{startSample:3000*48,endSample:15000*48},{startSample:15000*48,endSample:20000*48}];
 const segments=selectPreviewExcerpt({...clock,shots:[{id:'long',startFrame:0,endFrame:480,factIds:[]}],narration},[]);
 expect(segments).toEqual([{previewStartMs:0,previewEndMs:12000,sourceStartMs:3000,sourceEndMs:15000,shotId:'long'}]);
});
it('finds a safe six second gap away from the shot opening, midpoint and ending',()=>{
 const segments=selectPreviewExcerpt({...clock,totalFrames:49*24,shots:[{id:'long',startFrame:0,endFrame:49*24,factIds:[]}],narration:[{startSample:0,endSample:13000*48},{startSample:19000*48,endSample:49000*48}]},[]);
 expect(segments[0]).toMatchObject({sourceStartMs:13000,sourceEndMs:19000});
});
it('backs out of five tiny critical shots to form an available safe combination',()=>{
 const seconds=[1,1,1,1,1,1,5,5,4];let frame=0;
 const shots=seconds.map((seconds,i)=>{const startFrame=frame;frame+=seconds*24;return{id:'shot-'+i,startFrame,endFrame:frame,factIds:i<6?['fact-'+i]:[]}});
 const segments=selectPreviewExcerpt({...clock,totalFrames:frame,shots},Array.from({length:6},(_,i)=>'fact-'+i));
 expect(segments).toHaveLength(5);expect(validatePreviewSegments(segments,20000,24).durationMs).toBeGreaterThanOrEqual(6000);
 expect(segments.filter(segment=>Number(segment.shotId!.split('-')[1])<6)).toHaveLength(4);
});
it('combines safe sub-six-second ranges after fractional native shot boundaries',()=>{
 const boundaries=[0,121,241,361,480],shots=boundaries.slice(0,-1).map((startFrame,i)=>({id:'shot-'+i,startFrame,endFrame:boundaries[i+1],factIds:[]}));
 const narration=shots.map(shot=>{const startMs=Math.round(shot.startFrame*1000/24);return{startSample:startMs*48,endSample:(startMs+1000)*48}});
 const segments=selectPreviewExcerpt({...clock,shots,narration},[]);
 expect(validatePreviewSegments(segments,20000,24).durationMs).toBeGreaterThanOrEqual(6000);
 validatePreviewSpeechCoverage(segments,narration.map(line=>({startMs:line.startSample/48,endMs:line.endSample/48})),20000);
});
it('combines safe caption-free gaps when subtitle reading windows cross native cuts',()=>{
 const captions=[{startFrame:96,endFrame:144},{startFrame:216,endFrame:264},{startFrame:336,endFrame:384}];
 const segments=selectPreviewExcerpt({...clock,captions},[]);expect(validatePreviewSegments(segments,20000,24).durationMs).toBeGreaterThanOrEqual(6000);
 validatePreviewSpeechCoverage(segments,captions.map(cue=>({startMs:cue.startFrame*1000/24,endMs:cue.endFrame*1000/24})),20000);
});
