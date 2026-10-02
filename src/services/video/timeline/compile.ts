export interface ShotRange{id:string;startFrame:number;endFrame:number}
export interface CaptionRange{text:string;startFrame:number;endFrame:number}
export interface NarrationRange{lineId:string;durationMs:number;startMs:number}
export function quantizeCue(requestedTimeUs:number,fps:24|30|60,policy:'audio'|'frame'){
 if(!Number.isSafeInteger(requestedTimeUs)||requestedTimeUs<0)throw Error('TIMELINE_INVALID');
 const resolvedFrame=Math.round(requestedTimeUs*fps/1e6),actualUs=policy==='frame'?resolvedFrame/fps*1e6:requestedTimeUs;
 return{requestedTimeUs,resolvedFrame,resolvedSample:Math.round(actualUs*48000/1e6),quantizationErrorUs:actualUs-requestedTimeUs};
}
export function validateCaptions(captions:CaptionRange[],fps:24|30|60,glyphs:Set<string>){
 for(const caption of captions){for(const char of caption.text)if(!/\s/.test(char)&&!glyphs.has(char))throw Error('FONT_GLYPH_MISSING');
  const chars=Array.from(caption.text).filter(c=>! /\s/.test(c));const seconds=Math.max(1.8,chars.length/( /\p{Script=Han}/u.test(caption.text)?4.5:15)+1.5);
  if((caption.endFrame-caption.startFrame)/fps<seconds)throw Error('CAPTION_UNREADABLE');
 }
}
export function assertAsrExpected(originalExpected:string,proposedExpected:string,asr:string){if(originalExpected!==proposedExpected)throw Error('ASR_EXPECTATION_CHANGED');const normalize=(s:string)=>s.normalize('NFKC').replace(/[\p{P}\s]/gu,'').toLowerCase();if(normalize(originalExpected)!==normalize(asr))throw Error('ASR_MISMATCH')}
export function compileTimeline(input:{durationSec:number;fps:24|30|60;shots:ShotRange[];narration:NarrationRange[];captions:CaptionRange[]}){
 if(!Number.isInteger(input.durationSec)||input.durationSec<20||input.durationSec>120||![24,30,60].includes(input.fps))throw Error('TIMELINE_INVALID');
 const totalFrames=input.durationSec*input.fps,shots=[...input.shots].sort((a,b)=>a.startFrame-b.startFrame);let end=0;
 for(const shot of shots){if(!Number.isInteger(shot.startFrame)||!Number.isInteger(shot.endFrame)||shot.startFrame!==end||shot.endFrame<=shot.startFrame||shot.endFrame>totalFrames)throw Error('TIMELINE_COVERAGE');end=shot.endFrame}if(end!==totalFrames)throw Error('TIMELINE_COVERAGE');
 for(const line of input.narration)if(!Number.isInteger(line.durationMs)||line.durationMs<0||!Number.isInteger(line.startMs)||line.startMs<0||line.startMs+line.durationMs>input.durationSec*1000)throw Error('DURATION_CONFLICT');
 for(const c of input.captions)if(!Number.isInteger(c.startFrame)||!Number.isInteger(c.endFrame)||c.startFrame<0||c.endFrame>totalFrames||c.endFrame<=c.startFrame)throw Error('CAPTION_INVALID');
 return{totalFrames,fps:input.fps,sampleRate:48000 as const,totalSamples:input.durationSec*48000,shots,narration:input.narration.map(n=>({...n,startSample:n.startMs*48,endSample:(n.startMs+n.durationMs)*48})),captions:input.captions};
}
