export interface ShotRange{id:string;startFrame:number;endFrame:number}
export interface CaptionRange{text:string;startFrame:number;endFrame:number}
export interface NarrationRange{lineId:string;durationMs:number;startMs:number}
export function quantizeCue(requestedTimeUs:number,fps:24|30|60,policy:'audio'|'frame'){
 if(!Number.isSafeInteger(requestedTimeUs)||requestedTimeUs<0)throw Error('TIMELINE_INVALID');
 const resolvedFrame=Math.round(requestedTimeUs*fps/1e6);
 const resolvedSample=policy==='frame'?resolvedFrame*48000/fps:Math.round(requestedTimeUs*48000/1e6);
 return{requestedTimeUs,resolvedFrame,resolvedSample,quantizationErrorUs:resolvedSample*1e6/48000-requestedTimeUs};
}
export function validateCaptions(captions:CaptionRange[],fps:24|30|60,glyphs:Set<string>){
 for(const caption of captions){for(const char of caption.text)if(!/\s/.test(char)&&!glyphs.has(char))throw Error('FONT_GLYPH_MISSING');
  const chars=Array.from(caption.text).filter(c=>! /\s/.test(c));const seconds=Math.max(1.8,chars.length/( /\p{Script=Han}/u.test(caption.text)?4.5:15)+1.5);
  if((caption.endFrame-caption.startFrame)/fps<seconds)throw Error('CAPTION_UNREADABLE');
 }
}
function chineseNumber(value:string){
 const digits:Record<string,number>={零:0,〇:0,一:1,二:2,两:2,三:3,四:4,五:5,六:6,七:7,八:8,九:9};
 if(!/[十百千万]/.test(value))return Array.from(value,c=>digits[c]).join('');
 const units:Record<string,number>={十:10,百:100,千:1000,万:10000};let total=0,section=0,current=0;
 for(const char of value){const unit=units[char];if(!unit){current=digits[char];continue}
  if(unit===10000){total+=(section+current||1)*unit;section=0;current=0}
  else{section+=(current||1)*unit;current=0}
 }
 return String(total+section+current);
}
const traditionalToSimplified=OpenCC.Converter({from:'t',to:'cn'});
const englishOrdinalDays=new Map('first,second,third,fourth,fifth,sixth,seventh,eighth,ninth,tenth,eleventh,twelfth,thirteenth,fourteenth,fifteenth,sixteenth,seventeenth,eighteenth,nineteenth,twentieth,twenty-first,twenty-second,twenty-third,twenty-fourth,twenty-fifth,twenty-sixth,twenty-seventh,twenty-eighth,twenty-ninth,thirtieth,thirty-first'.split(',').map((word,index)=>[word,index+1]));
const englishDatePattern=new RegExp(`\\b(January|February|March|April|May|June|July|August|September|October|November|December)\\s+(${[...englishOrdinalDays.keys()].sort((a,b)=>b.length-a.length).map(word=>word.replace(/-/g,'[ -]+')).join('|')}|\\d{1,2}(?:st|nd|rd|th)?)\\b`,'gi');
function normalizeEnglishDate(value:string){
 return value.replace(englishDatePattern,(match,month:string,ordinal:string)=>{
  const word=ordinal.toLowerCase().replace(/[ -]+/g,'-'),numeric=/^(\d{1,2})(st|nd|rd|th)?$/.exec(word),day=englishOrdinalDays.get(word)??(numeric?Number(numeric[1]):undefined);
  if(day===undefined||day<1||day>31)return match;
  const suffix=day>=11&&day<=13?'th':['th','st','nd','rd'][day%10]??'th';
  if(numeric?.[2]&&numeric[2]!==suffix)return match;
  return `${month} ${day}`;
 });
}
function normalizeAsr(value:string){
 return normalizeEnglishDate(traditionalToSimplified(value.normalize('NFKC'))).replace(/([零〇一二三四五六七八九十百千万两]+)(?=年|月|日|号|点|分|秒|个|次|元|米|公里|倍|层|页|天|小时|分钟|%|％)/gu,match=>chineseNumber(match)).replace(/[\p{P}\s]/gu,'').toLowerCase();
}
export function assertAsrExpected(originalExpected:string,proposedExpected:string,asr:string){if(originalExpected!==proposedExpected)throw Error('ASR_EXPECTATION_CHANGED');if(normalizeAsr(originalExpected)!==normalizeAsr(asr))throw Error('ASR_MISMATCH')}
export function compileTimeline(input:{durationSec:number;fps:24|30|60;shots:ShotRange[];narration:NarrationRange[];captions:CaptionRange[]}){
 if(!Number.isInteger(input.durationSec)||input.durationSec<20||input.durationSec>120||![24,30,60].includes(input.fps))throw Error('TIMELINE_INVALID');
 const totalFrames=input.durationSec*input.fps,shots=[...input.shots].sort((a,b)=>a.startFrame-b.startFrame);let end=0;
 for(const shot of shots){if(!Number.isInteger(shot.startFrame)||!Number.isInteger(shot.endFrame)||shot.startFrame!==end||shot.endFrame<=shot.startFrame||shot.endFrame>totalFrames)throw Error('TIMELINE_COVERAGE');end=shot.endFrame}if(end!==totalFrames)throw Error('TIMELINE_COVERAGE');
 for(const line of input.narration)if(!Number.isInteger(line.durationMs)||line.durationMs<0||!Number.isInteger(line.startMs)||line.startMs<0||line.startMs+line.durationMs>input.durationSec*1000)throw Error('DURATION_CONFLICT');
 for(const c of input.captions)if(!Number.isInteger(c.startFrame)||!Number.isInteger(c.endFrame)||c.startFrame<0||c.endFrame>totalFrames||c.endFrame<=c.startFrame)throw Error('CAPTION_INVALID');
 return{totalFrames,fps:input.fps,sampleRate:48000 as const,totalSamples:input.durationSec*48000,shots,narration:input.narration.map(n=>({...n,startSample:n.startMs*48,endSample:(n.startMs+n.durationMs)*48})),captions:input.captions};
}
import OpenCC from 'opencc-js/t2cn';
