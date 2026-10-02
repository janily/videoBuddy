import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {lstat,mkdir} from 'node:fs/promises';
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
export function audioExtractArguments(image:string,user:string,path:string,outputDir:string){
 validatePath(outputDir);
 return[...audioDockerBase(image,user,path),'--mount',`type=bind,src=${outputDir},dst=/output`,image,'ffmpeg','-hide_banner','-loglevel','error','-xerror','-nostdin','-y','-i','/input/source','-map','0:a:0','-vn','-ar','24000','-ac','1','-c:a','pcm_f32le','/output/source.wav'];
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
 if(metadata.streams.length!==1||!Number.isFinite(durationSec)||durationSec<0.2||durationSec>30)throw Error('AUDIO_DURATION_UNSUPPORTED');
 const key=createHash('sha256').update(JSON.stringify([assetSha256,config.runtimeDigest,'source-audio-v1'])).digest('hex');
 const outputDir=join(root,'source',key,'output'),outputPath=join(outputDir,'source.wav');await mkdir(outputDir,{recursive:true,mode:0o700});
 let wav;try{wav=await inspectVoiceWav(outputPath)}catch(error){
  if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;
  await runDocker(audioExtractArguments(config.image,config.user,path,outputDir),1024);
  wav=await inspectVoiceWav(outputPath);
 }
 const transcript=await transcribeAudio(root,{language:'auto',outputPath,wav},'source',env);
 const segments=transcript.segments.map(segment=>({startMs:segment.startMs,endMs:segment.endMs,text:segment.text.trim()})).filter(segment=>segment.text&&segment.endMs>segment.startMs);
 if(!segments.length||segments.some(segment=>segment.endMs>durationSec*1000+1000))throw Error('AUDIO_TEXT_UNAVAILABLE');
 return{durationMs:Math.round(durationSec*1000),language:transcript.language,segments,asrRuntimeDigest:transcript.runtimeDigest,mediaRuntimeDigest:config.runtimeDigest,wavSha256:wav.sha256};
}
