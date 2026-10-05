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
import {canonicalHash} from '@/services/video/domain/hash';
import {assertRecognitionExpected,type RecognitionPolicy} from './recognition-policy';
import {assertSpeechReview,assertSpeechReviewLine,type ConfirmedSpeechReview} from './spoken-review';

const wordSchema=z.strictObject({text:z.string().max(100),startMs:z.number().int().nonnegative(),endMs:z.number().int().nonnegative(),probability:z.number().min(0).max(1)});
const segmentSchema=z.strictObject({text:z.string().max(1000),startMs:z.number().int().nonnegative(),endMs:z.number().int().nonnegative(),words:z.array(wordSchema).max(200)});
export const AsrModelSchema=z.enum(['Systran/faster-whisper-small','Systran/faster-whisper-medium']);
const transcriptSchema=z.strictObject({language:z.enum(['zh-CN','en']),model:AsrModelSchema,segments:z.array(segmentSchema).max(100)});
export const AsrTranscriptSchema=transcriptSchema.extend({voiceSha256:z.string().regex(/^[a-f0-9]{64}$/),runtimeDigest:z.string().regex(/^[a-f0-9]{64}$/),recognizedText:z.string().min(1).max(2000)});
export type AsrTranscript=z.infer<typeof AsrTranscriptSchema>;
export type SpeechReviewEvidence={ref:import('@/contracts/video/domain').ObjectRef;planSha256:string;transcript:AsrTranscript};

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
export function verifySpokenText(originalExpectedAsrText:string,proposedExpectedAsrText:string,transcript:AsrTranscript,review?:ConfirmedSpeechReview,recognitionPolicy?:RecognitionPolicy){
 let status:'pass'|'trusted_review'='pass';
 try{if(recognitionPolicy&&transcript.language!=='zh-CN')throw Error('ASR_POLICY_INVALID');assertRecognitionExpected(originalExpectedAsrText,proposedExpectedAsrText,transcript.recognizedText,recognitionPolicy)}catch(error){
  if((error as Error).message!=='ASR_MISMATCH'||!review)throw error;
  assertSpeechReview(originalExpectedAsrText,transcript,review);status='trusted_review';
 }
 const words=transcript.segments.flatMap(segment=>segment.words);
 if(words.length===0||words.some(word=>!word.text.trim()||word.endMs<=word.startMs))throw Error('ASR_TIMINGS_UNAVAILABLE');
 for(let i=1;i<words.length;i++)if(words[i].startMs<words[i-1].endMs)throw Error('ASR_TIMINGS_UNAVAILABLE');
 return{status,...(recognitionPolicy?{recognitionPolicy}:{}),model:transcript.model,voiceSha256:transcript.voiceSha256,recognizedText:transcript.recognizedText,words,...(status==='trusted_review'?{speechReviewRef:review!.ref}:{})};
}

export type VerifiedNarrationManifest={durationMs:number;lines:Array<Omit<NarrationManifest['lines'][number],'asrStatus'|'wordTimingsStatus'> & {asrStatus:'pass'|'trusted_review';speechReview?:SpeechReviewEvidence;wordTimingsStatus:'available';asr:{model:AsrTranscript['model'];runtimeDigest:string;voiceSha256:string;recognitionPolicy?:RecognitionPolicy};recognizedText:string;wordTimings:Array<{text:string;startMs:number;endMs:number;probability:number}>}>};
export async function verifyNarration(originalPlan:NarrationPlan,manifest:NarrationManifest,root:string,recognize:(root:string,voice:VoiceResult)=>Promise<AsrTranscript>=transcribeVoice,resolveReview?:(line:NarrationPlan['lines'][number],voice:VoiceResult,transcript:AsrTranscript)=>Promise<ConfirmedSpeechReview|undefined>,recognitionPolicy?:RecognitionPolicy):Promise<VerifiedNarrationManifest>{
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
  const policy=line.language==='zh-CN'?recognitionPolicy:undefined;
  let review:ConfirmedSpeechReview|undefined;
  try{assertRecognitionExpected(source.expectedAsrText,line.expectedAsrText,transcript.recognizedText,policy)}catch(error){if((error as Error).message!=='ASR_MISMATCH')throw error;review=await resolveReview?.(source,line.voice,transcript)}
  if(review)assertSpeechReviewLine(review,source,line.voice.runtimeDigest,canonicalHash(originalPlan));
  const verified=verifySpokenText(source.expectedAsrText,line.expectedAsrText,transcript,review,policy);
  lines.push({...line,asrStatus:verified.status,...(verified.status==='trusted_review'?{speechReview:{ref:review!.ref,planSha256:canonicalHash(originalPlan),transcript}}:{}),wordTimingsStatus:'available',asr:{model:transcript.model,runtimeDigest:transcript.runtimeDigest,voiceSha256:transcript.voiceSha256,...(policy?{recognitionPolicy:policy}:{})},recognizedText:verified.recognizedText,wordTimings:verified.words});
 }
 return{durationMs:manifest.durationMs,lines};
}

// Structural guard only. Durable stage/package boundaries additionally load the
// owner-bound confirmation and validate its audio, plan and transcript hashes.
export function hasVerifiedNarrationStatus(line:VerifiedNarrationManifest['lines'][number]){
 return line.asrStatus==='pass'&&!line.speechReview||line.asrStatus==='trusted_review'&&Boolean(line.speechReview);
}
