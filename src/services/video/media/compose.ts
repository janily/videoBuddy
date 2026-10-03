import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {lstat,mkdir,open,readFile} from 'node:fs/promises';
import {isAbsolute,join} from 'node:path';
import {Environment} from '@/services/video/config/environment';
import type {CompositionTrack} from '@/services/video/audio/master';
import {formatSrt,readPinnedSubtitleFont,SubtitleCue} from '@/services/video/audio/subtitles';
import {inspectTrackWav,inspectStereoTrackWav} from '@/services/video/audio/wav';
import {measureFinalLoudness} from '@/services/video/audio/loudness';
import {dockerConfiguration} from './docker-executor';
import {technicalVideoQa} from './technical-qa';

export interface CaptionStyle{fontSize:number;marginV:number;outline:number;primary:string;outlineColor:string}
export interface CompositionSpec{width:number;height:number;durationSec:number;fps:24|30|60;bundleHash:string;fence:number}
function color(value:string){
 if(!/^#[a-fA-F0-9]{6}$/.test(value))throw Error('CAPTION_STYLE_INVALID');
 return`&H00${value.slice(5,7)}${value.slice(3,5)}${value.slice(1,3)}&`.toUpperCase();
}
export function validateCaptionStyle(style:CaptionStyle){
 if(!Number.isInteger(style.fontSize)||style.fontSize<16||style.fontSize>100||!Number.isInteger(style.marginV)||style.marginV<0||style.marginV>180||!Number.isInteger(style.outline)||style.outline<0||style.outline>5)throw Error('CAPTION_STYLE_INVALID');
 return`FontName=Noto Sans CJK SC,FontSize=${style.fontSize},PrimaryColour=${color(style.primary)},OutlineColour=${color(style.outlineColor)},Outline=${style.outline},Alignment=2,MarginV=${style.marginV}`;
}
export function composeStageKey(input:{pictureSha256:string;trackSha256:string;trackSilent:boolean;srtSha256:string|null;style:CaptionStyle|null;runtimeDigest:string;spec:CompositionSpec}){
 const {spec}=input;
 if(!/^[a-f0-9]{64}$/.test(input.pictureSha256)||!/^[a-f0-9]{64}$/.test(input.trackSha256)||input.srtSha256!==null&&!/^[a-f0-9]{64}$/.test(input.srtSha256)||!/^[a-f0-9]{64}$/.test(input.runtimeDigest)||!/^[a-f0-9]{64}$/.test(spec.bundleHash)||!Number.isSafeInteger(spec.fence)||spec.fence<0)throw Error('COMPOSITION_INVALID');
 if(input.style)validateCaptionStyle(input.style);
 return createHash('sha256').update(JSON.stringify([input.pictureSha256,input.trackSha256,input.trackSilent,input.srtSha256,input.style,input.runtimeDigest,spec,'composition-v3-compressor-loudnorm'])).digest('hex');
}
export function composeDockerArguments(image:string,user:string,key:string,picturePath:string,trackPath:string,srtPath:string|null,outputDir:string,style:CaptionStyle|null,trackSilent:boolean,channels:1|2=1){
 if(!/^sha256:[a-f0-9]{64}$/.test(image)||!/^\d+:\d+$/.test(user)||!/^[a-f0-9]{64}$/.test(key)||[picturePath,trackPath,outputDir,...(srtPath?[srtPath]:[])].some(path=>!isAbsolute(path)||!/^\/[A-Za-z0-9_./-]+$/.test(path))||Boolean(srtPath)!==Boolean(style))throw Error('COMPOSITION_INVALID');
 if(channels!==1&&channels!==2)throw Error('COMPOSITION_INVALID');
 const args=['run','--rm','--name',`vb-compose-${key.slice(0,24)}`,'--network','none','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges','--pids-limit','128','--cpus','4','--memory','2g','--memory-swap','2g','--user',user,'--tmpfs','/tmp:rw,nosuid,size=128m','--mount',`type=bind,src=${picturePath},dst=/input/picture.mp4,readonly`,'--mount',`type=bind,src=${trackPath},dst=/input/track.wav,readonly`];
 if(srtPath)args.push('--mount',`type=bind,src=${srtPath},dst=/input/subtitles.srt,readonly`);
 args.push('--mount',`type=bind,src=${outputDir},dst=/output`,image,'ffmpeg','-hide_banner','-loglevel','error','-xerror','-nostdin','-y','-threads','2','-filter_threads','2','-i','/input/picture.mp4','-i','/input/track.wav','-map','0:v:0','-map','1:a:0');
 if(style){args.push('-vf',`subtitles=filename=/input/subtitles.srt:force_style='${validateCaptionStyle(style)}'`,'-c:v','libx264','-preset','medium','-crf','18')}
 else args.push('-c:v','copy');
 args.push('-pix_fmt','yuv420p','-color_primaries','bt709','-color_trc','bt709','-colorspace','bt709');
 if(!trackSilent)args.push('-af','acompressor=threshold=0.08:ratio=4:attack=2:release=100:detection=peak,loudnorm=I=-14:TP=-1.5:LRA=11');
 args.push('-c:a','aac','-b:a','192k','-ar','48000','-ac',String(channels),'-movflags','+faststart','/output/final.mp4');
 return args;
}
async function writeOnce(path:string,value:string){
 try{const file=await open(path,'wx',0o600);try{await file.writeFile(value);await file.sync()}finally{await file.close()}}
 catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;const info=await lstat(path);if(!info.isFile()||info.isSymbolicLink()||info.nlink!==1||await readFile(path,'utf8')!==value)throw Error('COMPOSITION_STAGE_UNKNOWN')}
}
async function docker(args:string[]){
 const child=spawn('docker',args,{stdio:['ignore','ignore','pipe'],signal:AbortSignal.timeout(180000)}),errors:Buffer[]=[];let size=0;
 child.stderr.on('data',(part:Buffer)=>{size+=part.length;if(size<=8192)errors.push(part)});
 const code=await new Promise<number>((resolve,reject)=>{child.once('error',reject);child.once('close',value=>resolve(value??1))});
 if(code!==0)throw Error(`COMPOSITION_FAILED: docker exit ${code}; ${Buffer.concat(errors).toString('utf8').slice(0,300)}`);
}
export async function composeVideo(root:string,pictureStageDir:string,track:CompositionTrack,cues:SubtitleCue[],style:CaptionStyle|null,spec:CompositionSpec,env:Environment=process.env){
 if(!isAbsolute(root)||!isAbsolute(pictureStageDir)||!Number.isInteger(spec.width)||!Number.isInteger(spec.height)||spec.width<64||spec.height<64||spec.width>3840||spec.height>3840||spec.width%2||spec.height%2||!Number.isInteger(spec.durationSec)||spec.durationSec<20||spec.durationSec>120||![24,30,60].includes(spec.fps)||Boolean(cues.length)!==Boolean(style))throw Error('COMPOSITION_INVALID');
 const config=dockerConfiguration(env,'composition'),picturePath=join(pictureStageDir,'output','picture.mp4');
 const picture=await technicalVideoQa(pictureStageDir,config.image,'output/picture.mp4',{width:spec.width,height:spec.height,durationSec:spec.durationSec,fps:spec.fps,audio:false});
 const trackProbe=track.wav.channels===2?await inspectStereoTrackWav(track.outputPath,spec.durationSec*48000,track.wav.silence):await inspectTrackWav(track.outputPath,spec.durationSec*48000,track.wav.silence);
 if(trackProbe.sha256!==track.wav.sha256||trackProbe.silence!==track.wav.silence||track.runtimeDigest!==config.runtimeDigest)throw Error('COMPOSITION_SOURCE_CHANGED');
 const srt=formatSrt(cues),srtSha256=srt?createHash('sha256').update(srt).digest('hex'):null;
 if(cues.length){
  const font=await readPinnedSubtitleFont(env);
  for(const cue of cues)for(const char of cue.text)if(!/\s/.test(char)&&!font.glyphs.has(char))throw Error('FONT_GLYPH_MISSING');
  if(font.runtimeDigest!==config.runtimeDigest)throw Error('COMPOSITION_SOURCE_CHANGED');
 }
 const key=composeStageKey({pictureSha256:picture.sha256,trackSha256:trackProbe.sha256,trackSilent:trackProbe.silence,srtSha256,style,runtimeDigest:config.runtimeDigest,spec}),stageDir=join(root,'composition',key),outputDir=join(stageDir,'output'),outputPath=join(outputDir,'final.mp4');
 await mkdir(outputDir,{recursive:true,mode:0o700});
 const srtPath=cues.length?join(stageDir,'subtitles.srt'):null;
 if(srtPath)await writeOnce(srtPath,srt);
 let exists=false;try{await lstat(outputPath);exists=true}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error}
 if(!exists)await docker(composeDockerArguments(config.image,config.user,key,picturePath,track.outputPath,srtPath,outputDir,style,trackProbe.silence,trackProbe.channels));
 const qa=await technicalVideoQa(stageDir,config.image,'output/final.mp4',{width:spec.width,height:spec.height,durationSec:spec.durationSec,fps:spec.fps,audio:true,...(trackProbe.channels===2?{audioChannels:2 as const}:{})});
 const loudness=await measureFinalLoudness(root,{outputPath,sha256:qa.sha256,durationMs:spec.durationSec*1000,technicalQa:'pass'},trackProbe.silence,env);
 if(loudness.status==='fail')throw Error(`COMPOSITION_LOUDNESS_FAILED: ${JSON.stringify({integratedLufs:loudness.integratedLufs,truePeakDbtp:loudness.truePeakDbtp})}`);
 return{stageKey:key,outputPath,subtitlesPath:srtPath,technicalQa:qa,loudness,qaStatus:'semantic_not_checked' as const};
}
