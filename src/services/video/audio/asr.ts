import {runOwnedDocker} from '@/services/video/media/owned-docker';
import {assertDockerCacheReusable,type DockerJournal} from '@/services/video/media/docker-journal';
import {createHash} from 'node:crypto';
import {lstat,mkdir,open,readFile} from 'node:fs/promises';
import {isAbsolute,join,relative} from 'node:path';
import {z} from 'zod';
import {Environment} from '@/services/video/config/environment';
import {VoiceResult} from './voice';
import {NarrationManifest,NarrationPlan} from './narration';
import {inspectVoiceWav,VoiceWavProbe} from './wav';
import {assertAsrExpected} from '@/services/video/timeline/compile';

const wordSchema=z.strictObject({text:z.string().max(100),startMs:z.number().int().nonnegative(),endMs:z.number().int().nonnegative(),probability:z.number().min(0).max(1)});
const segmentSchema=z.strictObject({text:z.string().max(1000),startMs:z.number().int().nonnegative(),endMs:z.number().int().nonnegative(),words:z.array(wordSchema).max(200)});
export const AsrModelSchema=z.enum(['Systran/faster-whisper-small','Systran/faster-whisper-medium']);
const transcriptSchema=z.strictObject({language:z.enum(['zh-CN','en']),model:AsrModelSchema,segments:z.array(segmentSchema).max(100)});
export type AsrTranscript=z.infer<typeof transcriptSchema> & {voiceSha256:string;runtimeDigest:string;recognizedText:string};

export function asrConfiguration(env:Environment){
 const image=env.VIDEO_ASR_IMAGE_REF,digest=env.VIDEO_ASR_RUNTIME_DIGEST;
 if(!image||!digest||!/^sha256:[a-f0-9]{64}$/.test(image)||image!==`sha256:${digest}`)throw Error('ASR_RUNTIME_UNAVAILABLE');
 const parsed=AsrModelSchema.safeParse(env.VIDEO_ASR_MODEL??'Systran/faster-whisper-small');
 if(!parsed.success)throw Error('ASR_MODEL_UNAVAILABLE');
 const model=parsed.data;
 return{image,runtimeDigest:digest,model,timeoutMs:model==='Systran/faster-whisper-medium'?300000:120000,user:`${process.getuid?.()??10001}:${process.getgid?.()??10001}`};
}
export function asrDockerArguments(config:ReturnType<typeof asrConfiguration>,jobPath:string,voicePath:string){
 for(const path of [jobPath,voicePath])if(!isAbsolute(path)||!/^\/[A-Za-z0-9_./-]+$/.test(path))throw Error('ASR_JOB_INVALID');
 const memory=config.model==='Systran/faster-whisper-medium'?'6g':'2g';
 return['run','--rm','--network','none','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges','--pids-limit','128','--cpus','4','--memory',memory,'--memory-swap',memory,'--user',config.user,'--tmpfs','/tmp:rw,nosuid,size=128m','--mount',`type=bind,src=${jobPath},dst=/work/job.json,readonly`,'--mount',`type=bind,src=${voicePath},dst=/input/voice.wav,readonly`,config.image,'python3','/opt/videobuddy/asr/transcribe.py','/work/job.json'];
}
async function writeOnce(path:string,value:string,mustExist=false){
 if(mustExist){const info=await lstat(path);if(!info.isFile()||info.isSymbolicLink()||info.nlink!==1||await readFile(path,'utf8')!==value)throw Error('ASR_STAGE_UNKNOWN');return}
 try{const file=await open(path,'wx',0o600);try{await file.writeFile(value);await file.sync()}finally{await file.close()}}
 catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;const info=await lstat(path);if(!info.isFile()||info.isSymbolicLink()||info.nlink!==1||await readFile(path,'utf8')!==value)throw Error('ASR_STAGE_UNKNOWN')}
}
export interface AsrAudioInput{language:'zh-CN'|'en'|'auto';outputPath:string;wav:VoiceWavProbe}
function validateTranscript(raw:string,voice:AsrAudioInput,config:ReturnType<typeof asrConfiguration>):AsrTranscript{
 const parsed=transcriptSchema.parse(JSON.parse(raw));
 if(parsed.model!==config.model||voice.language!=='auto'&&parsed.language!==voice.language||parsed.segments.length===0)throw Error('ASR_OUTPUT_INVALID');
 let last=0;
 for(const segment of parsed.segments){
  if(segment.startMs<last||segment.endMs<segment.startMs||segment.endMs>voice.wav.durationMs+1000)throw Error('ASR_OUTPUT_INVALID');
  last=segment.endMs;
  for(const word of segment.words)if(word.endMs<word.startMs||word.endMs>voice.wav.durationMs+1000)throw Error('ASR_OUTPUT_INVALID');
 }
 const recognizedText=parsed.segments.map(segment=>segment.text).join('').trim();
 if(!recognizedText)throw Error('ASR_OUTPUT_INVALID');
 return{...parsed,voiceSha256:voice.wav.sha256,runtimeDigest:config.runtimeDigest,recognizedText};
}
export async function transcribeAudio(root:string,voice:AsrAudioInput,sourceDirectory:'voice'|'postmix'|'source',env:Environment=process.env,options:{assertActive?:()=>Promise<void>;mustExist?:boolean;journal?:DockerJournal}={}):Promise<AsrTranscript>{
 await options.assertActive?.();
 if(!isAbsolute(root))throw Error('ASR_JOB_INVALID');
 const rel=relative(join(root,sourceDirectory),voice.outputPath);
 if(!isAbsolute(voice.outputPath)||rel.startsWith('..')||isAbsolute(rel))throw Error('ASR_JOB_INVALID');
 const inspected=await inspectVoiceWav(voice.outputPath);
 if(inspected.sha256!==voice.wav.sha256)throw Error('ASR_SOURCE_CHANGED');
 const config=asrConfiguration(env),key=createHash('sha256').update(JSON.stringify([voice.language,inspected.sha256,config.runtimeDigest,config.model.split('/')[1]])).digest('hex');
 const stageDir=join(root,'asr',key),jobPath=join(stageDir,'job.json'),resultPath=join(stageDir,'transcript.json');
 if(!options.mustExist)await mkdir(stageDir,{recursive:true,mode:0o700});
 await writeOnce(jobPath,JSON.stringify({language:voice.language}),options.mustExist);
 let raw:string;
 try{raw=await readFile(resultPath,'utf8')}catch(error){
  if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;
  if(options.mustExist)throw Error('ASR_EVIDENCE_MISSING');
  raw=await runOwnedDocker(asrDockerArguments(config,jobPath,voice.outputPath),config.timeoutMs,config.image,options.assertActive,...(options.journal?[options.journal]:[]));
  validateTranscript(raw,voice,config);
  await options.assertActive?.();
  await writeOnce(resultPath,raw);
 }
 if(options.journal){const record=await assertDockerCacheReusable(options.journal,asrDockerArguments(config,jobPath,voice.outputPath),config.image);if(record&&record.output!==raw)throw Error('ASR_STAGE_UNKNOWN')}
 await options.assertActive?.();
 return validateTranscript(raw,voice,config);
}
export async function transcribeVoice(root:string,voice:VoiceResult,env:Environment=process.env):Promise<AsrTranscript>{
 return transcribeAudio(root,voice,'voice',env);
}
export function verifySpokenText(originalExpectedAsrText:string,proposedExpectedAsrText:string,transcript:AsrTranscript){
 assertAsrExpected(originalExpectedAsrText,proposedExpectedAsrText,transcript.recognizedText);
 const words=transcript.segments.flatMap(segment=>segment.words);
 if(words.length===0||words.some(word=>!word.text.trim()||word.endMs<=word.startMs))throw Error('ASR_TIMINGS_UNAVAILABLE');
 for(let i=1;i<words.length;i++)if(words[i].startMs<words[i-1].endMs)throw Error('ASR_TIMINGS_UNAVAILABLE');
 return{status:'pass' as const,model:transcript.model,voiceSha256:transcript.voiceSha256,recognizedText:transcript.recognizedText,words};
}

export type VerifiedNarrationManifest={durationMs:number;lines:Array<Omit<NarrationManifest['lines'][number],'asrStatus'|'wordTimingsStatus'> & {asrStatus:'pass';wordTimingsStatus:'available';asr:{model:AsrTranscript['model'];runtimeDigest:string;voiceSha256:string};recognizedText:string;wordTimings:Array<{text:string;startMs:number;endMs:number;probability:number}>}>};
export async function verifyNarration(originalPlan:NarrationPlan,manifest:NarrationManifest,root:string,recognize:(root:string,voice:VoiceResult)=>Promise<AsrTranscript>=transcribeVoice):Promise<VerifiedNarrationManifest>{
 if(originalPlan.durationMs!==manifest.durationMs||originalPlan.lines.length!==manifest.lines.length)throw Error('NARRATION_PLAN_CHANGED');
 const original=new Map(originalPlan.lines.map(line=>[line.lineId,line]));
 if(original.size!==originalPlan.lines.length||new Set(manifest.lines.map(line=>line.lineId)).size!==manifest.lines.length)throw Error('NARRATION_PLAN_CHANGED');
 const lines:VerifiedNarrationManifest['lines']=[];
 for(const line of manifest.lines){
  const source=original.get(line.lineId);
  if(!source||source.language!==line.language||source.spokenText!==line.spokenText||source.displayText!==line.displayText||source.startMs!==line.startMs||source.reservedMs!==line.reservedMs)throw Error('NARRATION_PLAN_CHANGED');
  if(source.expectedAsrText!==line.expectedAsrText)throw Error('ASR_EXPECTATION_CHANGED');
  const transcript=await recognize(root,line.voice);
  if(transcript.voiceSha256!==line.voice.wav.sha256)throw Error('ASR_SOURCE_CHANGED');
  if(transcript.language!==line.language)throw Error('ASR_OUTPUT_INVALID');
  const verified=verifySpokenText(source.expectedAsrText,line.expectedAsrText,transcript);
  lines.push({...line,asrStatus:'pass',wordTimingsStatus:'available',asr:{model:transcript.model,runtimeDigest:transcript.runtimeDigest,voiceSha256:transcript.voiceSha256},recognizedText:verified.recognizedText,wordTimings:verified.words});
 }
 return{durationMs:manifest.durationMs,lines};
}
