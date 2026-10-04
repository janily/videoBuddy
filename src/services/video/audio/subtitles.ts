import {hasVerifiedNarrationStatus} from './asr';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {Environment} from '@/services/video/config/environment';
import {dockerConfiguration} from '@/services/video/media/docker-executor';
import {validateCaptions} from '@/services/video/timeline/compile';
import {VerifiedNarrationManifest} from './asr';

export interface SubtitleCue{lineId:string;text:string;startFrame:number;endFrame:number;startMs:number;endMs:number;voiceSha256:string}

function validateText(value:string){
 if(!value||value.length>500||!value.trim()||/-->|[\u0000-\u0009\u000b-\u001f\u007f\r]/.test(value)||value.split('\n').length>2||value.split('\n').some(line=>!line.trim()))throw Error('CAPTION_TEXT_INVALID');
 return value;
}
export function parseFontCharset(value:string){
 if(!value||value.length>200000)throw Error('FONT_CHARSET_INVALID');
 const glyphs=new Set<string>();
 for(const item of value.trim().split(/\s+/)){
  if(!/^[a-fA-F0-9]{1,6}(?:-[a-fA-F0-9]{1,6})?$/.test(item))throw Error('FONT_CHARSET_INVALID');
  const [startText,endText]=item.split('-'),start=parseInt(startText,16),end=endText?parseInt(endText,16):start;
  if(start>end||end>0x10ffff||end-start>30000)throw Error('FONT_CHARSET_INVALID');
  for(let code=start;code<=end;code++)if(code<0xd800||code>0xdfff)glyphs.add(String.fromCodePoint(code));
  if(glyphs.size>200000)throw Error('FONT_CHARSET_INVALID');
 }
 return glyphs;
}
export async function readPinnedSubtitleFont(env:Environment=process.env){
 const config=dockerConfiguration(env,'subtitle-font');
 const args=['run','--rm','--network','none','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges','--pids-limit','64','--cpus','1','--memory','256m','--user',config.user,config.image,'fc-query','-i','2','-f','%{family}\n%{charset}','/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc'];
 const child=spawn('docker',args,{stdio:['ignore','pipe','pipe'],signal:AbortSignal.timeout(15000)}),output:Buffer[]=[],errors:Buffer[]=[];let outputSize=0;
 child.stdout.on('data',(part:Buffer)=>{outputSize+=part.length;if(outputSize<=250000)output.push(part);else child.kill()});
 child.stderr.on('data',(part:Buffer)=>{if(Buffer.concat(errors).length<2048)errors.push(part)});
 const code=await new Promise<number>((resolve,reject)=>{child.once('error',reject);child.once('close',value=>resolve(value??1))});
 if(code!==0||outputSize>250000)throw Error(`FONT_RUNTIME_UNAVAILABLE: ${Buffer.concat(errors).toString('utf8').slice(0,200)}`);
 const raw=Buffer.concat(output).toString('utf8'),split=raw.indexOf('\n');
 if(split<0||raw.slice(0,split)!=='Noto Sans CJK SC')throw Error('FONT_RUNTIME_UNAVAILABLE');
 const charset=raw.slice(split+1);
 return{family:'Noto Sans CJK SC' as const,runtimeDigest:config.runtimeDigest,charsetSha256:createHash('sha256').update(charset).digest('hex'),glyphs:parseFontCharset(charset)};
}
export async function readPinnedSubtitleFontFileHash(runtimeDigest:string){
 if(!/^[a-f0-9]{64}$/.test(runtimeDigest))throw Error('FONT_RUNTIME_UNAVAILABLE');
 const path='/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc';
 const args=['run','--rm','--network','none','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges','--pids-limit','64','--cpus','1','--memory','256m','--user',`${process.getuid?.()??10001}:${process.getgid?.()??10001}`,'sha256:'+runtimeDigest,'sha256sum',path];
 const child=spawn('docker',args,{stdio:['ignore','pipe','ignore'],signal:AbortSignal.timeout(15000)}),output:Buffer[]=[];let size=0;
 child.stdout.on('data',(part:Buffer)=>{size+=part.length;if(size<=512)output.push(part);else child.kill()});
 const code=await new Promise<number>((resolve,reject)=>{child.once('error',reject);child.once('close',value=>resolve(value??1))});
 const raw=Buffer.concat(output).toString('utf8');
 if(code!==0||size>512||!new RegExp('^[a-f0-9]{64}  '+path+'\\n$').test(raw))throw Error('FONT_RUNTIME_UNAVAILABLE');
 return raw.slice(0,64);
}
export function compileSubtitles(manifest:VerifiedNarrationManifest,fps:24|30|60,glyphs:Set<string>,options:{revealMs?:0|350}={}):SubtitleCue[]{
 if(options.revealMs!==undefined&&options.revealMs!==0&&options.revealMs!==350)throw Error('CAPTION_PLAN_INVALID');
 if(!Number.isSafeInteger(manifest.durationMs)||manifest.durationMs<20000||manifest.durationMs>120000||![24,30,60].includes(fps)||manifest.lines.length>120)throw Error('CAPTION_PLAN_INVALID');
 const ordered=[...manifest.lines].sort((a,b)=>a.startMs-b.startMs),totalFrames=manifest.durationMs*fps/1000,cues:SubtitleCue[]=[];
 if(!Number.isSafeInteger(totalFrames))throw Error('CAPTION_PLAN_INVALID');
 for(const line of ordered){
  const text=validateText(line.displayText);
  if(!hasVerifiedNarrationStatus(line)||line.wordTimingsStatus!=='available'||!Number.isSafeInteger(line.startMs)||line.startMs<0||!Number.isSafeInteger(line.durationMs)||line.durationMs<=0||line.durationMs!==line.voice.wav.durationMs||!line.voice.wav.sha256)throw Error('CAPTION_PLAN_INVALID');
  const chars=Array.from(text).filter(char=>!/\s/.test(char)).length,readingMs=Math.ceil((chars/(/\p{Script=Han}/u.test(text)?4.5:15)+1.5)*1000);
  const lastWord=Math.max(0,...line.wordTimings.map(word=>word.endMs));
  if(line.wordTimings.length===0||line.wordTimings.some(word=>!Number.isSafeInteger(word.startMs)||!Number.isSafeInteger(word.endMs)||word.startMs<0||word.endMs<=word.startMs)||lastWord>line.durationMs+1000)throw Error('CAPTION_PLAN_INVALID');
  const requestedEnd=line.startMs+Math.max(1800,line.durationMs+600,lastWord+600,readingMs);
  const startFrame=Math.floor(line.startMs*fps/1000),endFrame=Math.ceil(requestedEnd*fps/1000)+Math.ceil((options.revealMs||0)*fps/1000);
  if(startFrame<0||endFrame>totalFrames||endFrame<=startFrame||startFrame<(cues.at(-1)?.endFrame??0))throw Error('CAPTION_CONFLICT');
  cues.push({lineId:line.lineId,text,startFrame,endFrame,startMs:Math.round(startFrame*1000/fps),endMs:Math.round(endFrame*1000/fps),voiceSha256:line.voice.wav.sha256});
 }
 validateCaptions(cues.map(cue=>({text:cue.text,startFrame:cue.startFrame+Math.ceil((options.revealMs||0)*fps/1000),endFrame:cue.endFrame})),fps,glyphs);
 return cues;
}
function stamp(ms:number){
 if(!Number.isSafeInteger(ms)||ms<0||ms>=3600000)throw Error('SRT_INVALID');
 const hours=Math.floor(ms/3600000),minutes=Math.floor(ms%3600000/60000),seconds=Math.floor(ms%60000/1000),milliseconds=ms%1000;
 return`${String(hours).padStart(2,'0')}:${String(minutes).padStart(2,'0')}:${String(seconds).padStart(2,'0')},${String(milliseconds).padStart(3,'0')}`;
}
export function formatSrt(cues:SubtitleCue[]){
 let end=0;
 return cues.map((cue,index)=>{
  validateText(cue.text);
  if(cue.startMs<end||cue.endMs<=cue.startMs)throw Error('SRT_INVALID');
  end=cue.endMs;
  return`${index+1}\n${stamp(cue.startMs)} --> ${stamp(cue.endMs)}\n${cue.text}\n`;
 }).join('\n');
}
