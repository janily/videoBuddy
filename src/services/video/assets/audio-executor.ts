import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {lstat,mkdir,readFile} from 'node:fs/promises';
import {isAbsolute,join} from 'node:path';
import {z} from 'zod';
import {Environment} from '@/services/video/config/environment';
import {dockerConfiguration} from '@/services/video/media/docker-executor';
import {transcribeAudio} from '@/services/video/audio/asr';
import {inspectVoiceWav} from '@/services/video/audio/wav';

const metadataSchema=z.object({streams:z.array(z.object({codec_name:z.string()})),format:z.object({duration:z.string()})});
function validatePath(path:string){if(!isAbsolute(path)||!/^\/[A-Za-z0-9_./-]+$/.test(path))throw Error('AUDIO_SOURCE_INVALID')}
function audioDockerBase(image:string,user:string,path:string){
 if(!/^sha256:[a-f0-9]{64}$/.test(image)||!/^\d+:\d+$/.test(user))throw Error('AUDIO_SOURCE_INVALID');validatePath(path);
 return['run','--rm','--network','none','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges','--pids-limit','64','--cpus','2','--memory','1g','--memory-swap','1g','--user',user,'--mount',`type=bind,src=${path},dst=/input/source,readonly`];
}
export function audioProbeArguments(image:string,user:string,path:string){
 return[...audioDockerBase(image,user,path),image,'ffprobe','-v','error','-select_streams','a:0','-show_entries','stream=codec_name:format=duration','-of','json','/input/source'];
}
export function audioExtractArguments(image:string,user:string,path:string,outputDir:string,startMs:number,lengthMs:number,index:number){
 validatePath(outputDir);
 if(!Number.isSafeInteger(startMs)||startMs<0||!Number.isSafeInteger(lengthMs)||lengthMs<200||lengthMs>30000||!Number.isSafeInteger(index)||index<0||index>5)throw Error('AUDIO_SOURCE_INVALID');
 return[...audioDockerBase(image,user,path),'--mount',`type=bind,src=${outputDir},dst=/output`,image,'ffmpeg','-hide_banner','-loglevel','error','-xerror','-nostdin','-y','-i','/input/source','-ss',String(startMs/1000),'-t',String(lengthMs/1000),'-map','0:a:0','-vn','-ar','24000','-ac','1','-c:a','pcm_f32le',`/output/part-${index}.wav`];
}
export function audioChunkRanges(durationMs:number){
 if(!Number.isSafeInteger(durationMs)||durationMs<200||durationMs>120000)throw Error('AUDIO_DURATION_UNSUPPORTED');
 const count=Math.ceil(durationMs/25000),size=Math.ceil(durationMs/count);
 return Array.from({length:count},(_,index)=>{const startMs=index*size;return{index,startMs,lengthMs:Math.min(size,durationMs-startMs)}});
}
export function audioExtractionWindow(range:ReturnType<typeof audioChunkRanges>[number],durationMs:number){
 const startMs=Math.max(0,range.startMs-2000),endMs=Math.min(durationMs,range.startMs+range.lengthMs+2000);
 return{startMs,lengthMs:endMs-startMs};
}
export function activeVoiceWindows(bytes:Buffer,offsetMs:number,coreStartMs:number,coreEndMs:number){
 let cursor=12,data:Buffer|undefined;
 while(cursor+8<=bytes.length){const size=bytes.readUInt32LE(cursor+4),start=cursor+8;if(start+size>bytes.length)throw Error('AUDIO_SOURCE_INVALID');if(bytes.toString('ascii',cursor,cursor+4)==='data')data=bytes.subarray(start,start+size);cursor=start+size+(size%2)}
 if(!data||data.length%4)throw Error('AUDIO_SOURCE_INVALID');
 const windows:Array<{startMs:number;endMs:number}>=[],total=data.length/4;
 for(let start=0;start<total;start+=2400){
  const end=Math.min(start+2400,total),fromMs=offsetMs+start/24,toMs=offsetMs+end/24,middle=(fromMs+toMs)/2;
  if(middle<coreStartMs||middle>=coreEndMs)continue;
  let sum=0;for(let sample=start;sample<end;sample++){const value=data.readFloatLE(sample*4);sum+=value*value}
  if(Math.sqrt(sum/(end-start))>=0.005)windows.push({startMs:fromMs,endMs:toMs});
 }
 return windows;
}
export function assertTranscriptCoverage(windows:Array<{startMs:number;endMs:number}>,segments:Array<{startMs:number;endMs:number}>){
 let missedStart:number|null=null,lastEnd=0;
 for(const window of windows.sort((a,b)=>a.startMs-b.startMs)){
  const middle=(window.startMs+window.endMs)/2,covered=segments.some(segment=>middle>=segment.startMs-350&&middle<=segment.endMs+350);
  if(covered||window.startMs-lastEnd>150)missedStart=null;
  if(!covered){missedStart??=window.startMs;if(window.endMs-missedStart>=600)throw Error('AUDIO_TRANSCRIPT_INCOMPLETE')}
  lastEnd=window.endMs;
 }
}
async function runDocker(args:string[],maxOutput:number){
 const child=spawn('docker',args,{stdio:['ignore','pipe','pipe'],signal:AbortSignal.timeout(120000)}),out:Buffer[]=[],err:Buffer[]=[];let size=0;
 child.stdout.on('data',(part:Buffer)=>{size+=part.length;if(size<=maxOutput)out.push(part);else child.kill()});
 child.stderr.on('data',(part:Buffer)=>{if(Buffer.concat(err).length<4096)err.push(part)});
 const code=await new Promise<number>((resolve,reject)=>{child.once('error',reject);child.once('close',value=>resolve(value??1))});
 if(code!==0||size>maxOutput)throw Error(`AUDIO_EXTRACTION_FAILED: docker exit ${code}`);
 return Buffer.concat(out).toString('utf8');
}
export async function transcribeSourceAsset(root:string,path:string,assetSha256:string,env:Environment=process.env){
 validatePath(root);validatePath(path);
 if(!/^[a-f0-9]{64}$/.test(assetSha256))throw Error('AUDIO_SOURCE_INVALID');
 const file=await lstat(path);if(!file.isFile()||file.isSymbolicLink()||file.nlink!==1||file.size>50*1024*1024)throw Error('AUDIO_SOURCE_INVALID');
 const hash=createHash('sha256');for await(const chunk of createReadStream(path))hash.update(chunk);if(hash.digest('hex')!==assetSha256)throw Error('ASSET_HASH_CONFLICT');
 const config=dockerConfiguration(env,'source-audio');
 const metadata=metadataSchema.parse(JSON.parse(await runDocker(audioProbeArguments(config.image,config.user,path),8192)));
 const durationSec=Number(metadata.format.duration);
 const durationMs=Math.round(durationSec*1000);
 if(metadata.streams.length!==1||!Number.isFinite(durationSec))throw Error('AUDIO_DURATION_UNSUPPORTED');
 const ranges=audioChunkRanges(durationMs);
 const key=createHash('sha256').update(JSON.stringify([assetSha256,config.runtimeDigest,'source-audio-v3-overlap'])).digest('hex');
 const outputDir=join(root,'source',key,'output');await mkdir(outputDir,{recursive:true,mode:0o700});
 const segments:Array<{startMs:number;endMs:number;text:string;language:'zh-CN'|'en'}>=[],wavChunks:Array<{startMs:number;sha256:string}>=[],activeWindows:Array<{startMs:number;endMs:number}>=[],languages=new Set<'zh-CN'|'en'>();let runtimeDigest='';
 for(const range of ranges){
  const window=audioExtractionWindow(range,durationMs);
  const outputPath=join(outputDir,`part-${range.index}.wav`);
  let wav;try{wav=await inspectVoiceWav(outputPath)}catch(error){
   if((error as NodeJS.ErrnoException).code==='ENOENT'){
    await runDocker(audioExtractArguments(config.image,config.user,path,outputDir,window.startMs,window.lengthMs,range.index),1024);
    try{wav=await inspectVoiceWav(outputPath)}catch(failure){if((failure as Error).message==='VOICE_SILENT')continue;throw failure}
   }else if((error as Error).message==='VOICE_SILENT')continue;
   else throw error;
  }
  activeWindows.push(...activeVoiceWindows(await readFile(outputPath),window.startMs,range.startMs,range.startMs+range.lengthMs));
  const transcript=await transcribeAudio(root,{language:'auto',outputPath,wav},'source',env);
  wavChunks.push({startMs:window.startMs,sha256:wav.sha256});languages.add(transcript.language);runtimeDigest=transcript.runtimeDigest;
  for(const segment of transcript.segments){
   const startMs=window.startMs+segment.startMs,endMs=window.startMs+segment.endMs,text=segment.text.trim(),middle=(startMs+endMs)/2;
   if(text&&endMs>startMs&&middle>=range.startMs&&middle<range.startMs+range.lengthMs)segments.push({startMs,endMs,text,language:transcript.language});
  }
 }
 assertTranscriptCoverage(activeWindows,segments);
 if(!segments.length||segments.some(segment=>segment.endMs>durationMs+1000)||!runtimeDigest)throw Error('AUDIO_TEXT_UNAVAILABLE');
 return{durationMs,language:languages.size===1?[...languages][0]!:'mixed' as const,segments,asrRuntimeDigest:runtimeDigest,mediaRuntimeDigest:config.runtimeDigest,wavChunks,chunkCount:ranges.length};
}
