import{spawn}from 'node:child_process';
import{lstat,mkdir}from 'node:fs/promises';
import{isAbsolute,join,relative}from 'node:path';
import type{Environment}from '@/services/video/config/environment';
import{canonicalHash}from '@/services/video/domain/hash';
import{dockerConfiguration}from '@/services/video/media/docker-executor';
import{technicalVideoQa}from '@/services/video/media/technical-qa';
import{validateExcerptMap,type ExcerptSegment}from './excerpt';

export function validatePreviewSegments(segments:ExcerptSegment[],sourceDurationMs:number,fps:24|30|60){
 if(!Number.isSafeInteger(sourceDurationMs)||sourceDurationMs<20000||sourceDurationMs>120000||![24,30,60].includes(fps)||segments.length>5)throw Error('EXCERPT_INVALID');
 const durationMs=validateExcerptMap(segments,sourceDurationMs);
 for(const segment of segments){
  if(segment.sourceStartMs===null||segment.sourceEndMs===null||!segment.shotId||
   [segment.previewStartMs,segment.previewEndMs,segment.sourceStartMs,segment.sourceEndMs].some(ms=>ms*fps%1000!==0))throw Error('EXCERPT_UNRENDERABLE');
 }
 return{durationMs,totalFrames:durationMs*fps/1000};
}
export interface PreviewSpeechWindow{startMs:number;endMs:number}
export function validatePreviewSpeechCoverage(segments:ExcerptSegment[],speechWindows:PreviewSpeechWindow[],sourceDurationMs:number){
 validateExcerptMap(segments,sourceDurationMs);
 for(const window of speechWindows){
  if(!Number.isSafeInteger(window.startMs)||!Number.isSafeInteger(window.endMs)||window.startMs<0||window.endMs<=window.startMs||window.endMs>sourceDurationMs)throw Error('EXCERPT_SPEECH_INVALID');
  for(const segment of segments){
   if(segment.sourceStartMs===null||segment.sourceEndMs===null)continue;
   if(window.startMs<segment.sourceEndMs&&window.endMs>segment.sourceStartMs&&
    (window.startMs<segment.sourceStartMs||window.endMs>segment.sourceEndMs))throw Error('EXCERPT_SPEECH_CUT');
  }
 }
}
export function previewExcerptStageKey(input:{fullFilmSha256:string;segments:ExcerptSegment[];width:number;height:number;fps:24|30|60;runtimeDigest:string}){
 if(!/^[a-f0-9]{64}$/.test(input.fullFilmSha256)||!/^[a-f0-9]{64}$/.test(input.runtimeDigest)||![input.width,input.height].every(value=>Number.isInteger(value)&&value>=64&&value<=3840&&value%2===0)||![24,30,60].includes(input.fps))throw Error('EXCERPT_INVALID');
 return canonicalHash({...input,version:'preview-excerpt-v1'});
}
export function excerptDockerArguments(image:string,user:string,stageKey:string,sourcePath:string,outputDir:string,segments:ExcerptSegment[],fps:24|30|60){
 if(!/^sha256:[a-f0-9]{64}$/.test(image)||!/^\d+:\d+$/.test(user)||!/^[a-f0-9]{64}$/.test(stageKey)||[sourcePath,outputDir].some(path=>!isAbsolute(path)||!/^\/[A-Za-z0-9_./-]+$/.test(path)))throw Error('EXCERPT_INVALID');
 const sourceDurationMs=Math.max(...segments.map(segment=>segment.sourceEndMs??0)),{durationMs,totalFrames}=validatePreviewSegments(segments,Math.max(20000,sourceDurationMs),fps);
 const filters=segments.flatMap((segment,index)=>{
  const start=segment.sourceStartMs!,end=segment.sourceEndMs!;
  return[`[0:v]trim=start_frame=${start*fps/1000}:end_frame=${end*fps/1000},setpts=PTS-STARTPTS[v${index}]`,
   `[0:a]atrim=start_sample=${start*48}:end_sample=${end*48},asetpts=PTS-STARTPTS[a${index}]`];
 });
 filters.push(`${segments.map((_,index)=>`[v${index}][a${index}]`).join('')}concat=n=${segments.length}:v=1:a=1[v][a]`);
 return['run','--rm','--network','none','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges','--pids-limit','128','--cpus','4','--memory','2g','--memory-swap','2g','--user',user,'--tmpfs','/tmp:rw,nosuid,size=128m','--mount',`type=bind,src=${sourcePath},dst=/input/full.mp4,readonly`,'--mount',`type=bind,src=${outputDir},dst=/output`,image,'ffmpeg','-hide_banner','-loglevel','error','-xerror','-nostdin','-y','-i','/input/full.mp4','-filter_complex',filters.join(';'),'-map','[v]','-map','[a]','-frames:v',String(totalFrames),'-t',String(durationMs/1000),'-r',String(fps),'-c:v','libx264','-preset','medium','-crf','18','-pix_fmt','yuv420p','-color_primaries','bt709','-color_trc','bt709','-colorspace','bt709','-c:a','aac','-b:a','192k','-ar','48000','-ac','1','-movflags','+faststart','/output/preview.mp4'];
}
async function runDocker(args:string[],timeoutMs:number){
 const child=spawn('docker',args,{stdio:['ignore','ignore','pipe'],signal:AbortSignal.timeout(timeoutMs)}),errors:Buffer[]=[];let size=0;
 child.stderr.on('data',(part:Buffer)=>{size+=part.length;if(size<=8192)errors.push(part)});
 const code=await new Promise<number>((resolve,reject)=>{child.once('error',reject);child.once('close',value=>resolve(value??1))});
 if(code!==0)throw Error(`EXCERPT_RENDER_FAILED: docker exit ${code}; ${Buffer.concat(errors).toString('utf8').slice(0,300)}`);
}
export async function renderPreviewExcerpt(input:{root:string;sourcePath:string;sourceSha256:string;sourceDurationMs:number;segments:ExcerptSegment[];speechWindows:PreviewSpeechWindow[];width:number;height:number;fps:24|30|60;env?:Environment}){
 const{root,sourcePath,sourceSha256,sourceDurationMs,segments,width,height,fps}=input;
 if(!isAbsolute(root)||!isAbsolute(sourcePath)||!/^\/[A-Za-z0-9_./-]+$/.test(root)||!/^\/[A-Za-z0-9_./-]+$/.test(sourcePath)||!/^([a-f0-9]{64})\/output\/final\.mp4$/.test(relative(join(root,'composition'),sourcePath)))throw Error('EXCERPT_SOURCE_INVALID');
 const config=dockerConfiguration(input.env||process.env,'preview-excerpt'),{durationMs}=validatePreviewSegments(segments,sourceDurationMs,fps);
 validatePreviewSpeechCoverage(segments,input.speechWindows,sourceDurationMs);
 const sourceStage=join(root,'composition',relative(join(root,'composition'),sourcePath).split('/')[0]);
 const source=await technicalVideoQa(sourceStage,config.image,'output/final.mp4',{width,height,durationSec:sourceDurationMs/1000,fps,audio:true});
 if(source.sha256!==sourceSha256)throw Error('EXCERPT_SOURCE_CHANGED');
 const stageKey=previewExcerptStageKey({fullFilmSha256:sourceSha256,segments,width,height,fps,runtimeDigest:config.runtimeDigest}),stageDir=join(root,'preview',stageKey),outputDir=join(stageDir,'output'),outputPath=join(outputDir,'preview.mp4');
 await mkdir(outputDir,{recursive:true,mode:0o700});
 let exists=false;try{await lstat(outputPath);exists=true}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error}
 if(!exists)await runDocker(excerptDockerArguments(config.image,config.user,stageKey,sourcePath,outputDir,segments,fps),config.timeoutSeconds*1000);
 const qa=await technicalVideoQa(stageDir,config.image,'output/preview.mp4',{width,height,durationSec:durationMs/1000,fps,audio:true});
 return{stageKey,outputPath,sha256:qa.sha256,bytes:qa.bytes,durationMs,sourceFilmSha256:sourceSha256,excerptMap:segments,technicalQa:qa};
}
