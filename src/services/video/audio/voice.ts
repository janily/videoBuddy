import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {lstat,mkdir,open,readFile} from 'node:fs/promises';
import {isAbsolute,join} from 'node:path';
import {z} from 'zod';
import {Environment} from '@/services/video/config/environment';
import {inspectVoiceWav,VoiceWavProbe} from './wav';

const jobSchema=z.strictObject({lineId:z.string().regex(/^[-a-zA-Z0-9_]{1,80}$/),language:z.enum(['zh-CN','en']),text:z.string().min(1).max(250).refine(text=>text.trim().length>0&&!/[\u0000-\u001f\u007f]/.test(text))});
export type VoiceJob=z.infer<typeof jobSchema>;
export type VoiceResult={lineId:string;language:VoiceJob['language'];voice:'zf_001'|'af_maple';provider:'kokoro-js';model:string;modelLicense:'Apache-2.0';runtimeDigest:string;outputPath:string;wav:VoiceWavProbe};

export function voiceConfiguration(env:Environment){
 const image=env.VIDEO_VOICE_IMAGE_REF,digest=env.VIDEO_VOICE_RUNTIME_DIGEST;
 if(!image||!digest||!/^sha256:[a-f0-9]{64}$/.test(image)||image!==`sha256:${digest}`)throw Error('VOICE_RUNTIME_UNAVAILABLE: pinned Docker image required');
 return{image,runtimeDigest:digest,user:`${process.getuid?.()??10001}:${process.getgid?.()??10001}`};
}
export function voiceStageKey(job:VoiceJob,digest:string){
 const input=jobSchema.parse(job);
 if(!/^[a-f0-9]{64}$/.test(digest))throw Error('VOICE_JOB_INVALID');
 return createHash('sha256').update(JSON.stringify([input.lineId,input.language,input.text,digest,'kokoro-js@1.2.4'])).digest('hex');
}
export function voiceDockerArguments(config:ReturnType<typeof voiceConfiguration>,stageDir:string,key:string){
 if(!isAbsolute(stageDir)||!/^\/[A-Za-z0-9_./-]+$/.test(stageDir)||!id(key))throw Error('VOICE_JOB_INVALID');
 return['run','--rm','--name',`vb-voice-${key.slice(0,24)}`,'--network','none','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges','--pids-limit','128','--cpus','4','--memory','4g','--memory-swap','4g','--user',config.user,'--tmpfs','/tmp:rw,nosuid,size=256m','--mount',`type=bind,src=${stageDir}/job.json,dst=/work/job.json,readonly`,'--mount',`type=bind,src=${stageDir}/output,dst=/output`,config.image,'node','/opt/videobuddy/voice/synth.mjs','/work/job.json'];
}
function id(value:string){return /^[a-f0-9]{64}$/.test(value)}
async function writeOnce(path:string,value:string,mustExist=false){
 if(mustExist){
  let info;try{info=await lstat(path)}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')throw Error('VOICE_EVIDENCE_MISSING');throw error}
  if(!info.isFile()||info.isSymbolicLink()||info.nlink!==1||await readFile(path,'utf8')!==value)throw Error('VOICE_STAGE_UNKNOWN');return;
 }
 try{const file=await open(path,'wx',0o600);try{await file.writeFile(value);await file.sync()}finally{await file.close()}}
 catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;
  const info=await lstat(path);if(!info.isFile()||info.isSymbolicLink()||info.nlink!==1||await readFile(path,'utf8')!==value)throw Error('VOICE_STAGE_UNKNOWN')}
}
async function runDocker(args:string[]){
 const child=spawn('docker',args,{stdio:['ignore','pipe','pipe'],signal:AbortSignal.timeout(240000)}),output:Buffer[]=[],errors:Buffer[]=[];
 let outputBytes=0,errorBytes=0;
 child.stdout.on('data',(part:Buffer)=>{outputBytes+=part.length;if(outputBytes<=8192)output.push(part);else child.kill()});
 child.stderr.on('data',(part:Buffer)=>{errorBytes+=part.length;if(errorBytes<=8192)errors.push(part)});
 const code=await new Promise<number>((resolve,reject)=>{child.once('error',reject);child.once('close',code=>resolve(code??1))});
 if(code!==0||outputBytes>8192)throw Error(`VOICE_SYNTHESIS_FAILED: docker exit ${code}; ${Buffer.concat(errors).toString('utf8').slice(0,300)}`);
 return Buffer.concat(output).toString('utf8').trim();
}
const resultSchema=z.strictObject({lineId:z.string(),language:z.enum(['zh-CN','en']),voice:z.enum(['zf_001','af_maple']),bytes:z.number().int().positive()});
export async function synthesizeVoice(root:string,job:VoiceJob,env:Environment=process.env,options:{mustExist?:boolean}={}):Promise<VoiceResult>{
 if(!isAbsolute(root))throw Error('VOICE_DATA_DIR_INVALID');
 const input=jobSchema.parse(job),config=voiceConfiguration(env),key=voiceStageKey(input,config.runtimeDigest);
 const stageDir=join(root,'voice',key),outputDir=join(stageDir,'output'),outputPath=join(outputDir,'narration.wav');
 if(!options.mustExist)await mkdir(outputDir,{recursive:true,mode:0o700});
 await writeOnce(join(stageDir,'job.json'),JSON.stringify(input),options.mustExist);
 let wav:VoiceWavProbe;
 try{wav=await inspectVoiceWav(outputPath)}catch(error){
  if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;
  if(options.mustExist)throw Error('VOICE_EVIDENCE_MISSING');
  const response=resultSchema.parse(JSON.parse(await runDocker(voiceDockerArguments(config,stageDir,key))));
  if(response.lineId!==input.lineId||response.language!==input.language||response.voice!==(input.language==='zh-CN'?'zf_001':'af_maple'))throw Error('VOICE_OUTPUT_INVALID');
  wav=await inspectVoiceWav(outputPath);
  if(wav.bytes!==response.bytes)throw Error('VOICE_OUTPUT_INVALID');
 }
 return{lineId:input.lineId,language:input.language,voice:input.language==='zh-CN'?'zf_001':'af_maple',provider:'kokoro-js',model:'onnx-community/Kokoro-82M-v1.1-zh-ONNX@6cc0f0d2ebe369a68b0df87c2b65c1af8c0ac3e3',modelLicense:'Apache-2.0',runtimeDigest:config.runtimeDigest,outputPath,wav};
}
