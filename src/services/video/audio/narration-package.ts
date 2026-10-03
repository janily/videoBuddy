import {spawn} from 'node:child_process';
import {constants} from 'node:fs';
import {open,realpath} from 'node:fs/promises';
import {isAbsolute,join,relative} from 'node:path';
import {z} from 'zod';
import {ObjectRefSchema,type ObjectRef} from '@/contracts/video/domain';
import type {FilmTimeline} from '@/contracts/video/film';
import {canonicalHash,canonicalJson} from '@/services/video/domain/hash';
import type {AtomicStore} from '@/services/video/storage/atomic-store';
import type {ProjectStore} from '@/services/video/storage/project-store';
import {assertAsrExpected} from '@/services/video/timeline/compile';
import type {TimingDraft} from '@/services/video/preview/timing-draft';
import type {VerifiedNarrationManifest} from './asr';
import {probeVoiceWav,type VoiceWavProbe} from './wav';

const digest=z.string().regex(/^[a-f0-9]{64}$/),lineId=z.string().regex(/^[-a-zA-Z0-9_]{1,80}$/),sample=z.number().int().nonnegative();
const voiceConfig=z.strictObject({language:z.enum(['zh-CN','en']),voice:z.enum(['zf_001','af_maple']),provider:z.literal('kokoro-js'),model:z.string().min(1).max(500),modelLicense:z.literal('Apache-2.0'),runtimeDigest:digest});
export const NarrationSourceSchema=z.strictObject({schemaVersion:z.literal(1),kind:z.literal('generated_narration'),lineId,displayText:z.string().min(1).max(500),spokenText:z.string().min(1).max(250),expectedAsrText:z.string().min(1).max(500),voiceConfig,voiceConfigHash:digest,audioRef:ObjectRefSchema,wordTimingsRef:ObjectRefSchema,startSample:sample,endSample:sample,
 wav:z.strictObject({codec:z.literal('pcm_f32le'),sampleRate:z.literal(24000),channels:z.literal(1),samples:z.number().int().positive(),durationMs:z.number().positive(),bytes:z.number().int().positive(),sha256:digest,peakDbfs:z.number().finite(),rmsDbfs:z.number().finite()})});
export const WordTimingManifestSchema=z.strictObject({schemaVersion:z.literal(1),lineId,voiceSha256:digest,asrModel:z.literal('Systran/faster-whisper-small'),asrRuntimeDigest:digest,recognizedText:z.string().min(1).max(2000),words:z.array(z.strictObject({text:z.string().min(1).max(100),startMs:z.number().int().nonnegative(),endMs:z.number().int().nonnegative(),probability:z.number().min(0).max(1)})).min(1).max(1000)});
type NarrationSource=z.infer<typeof NarrationSourceSchema>;
type WordTimingManifest=z.infer<typeof WordTimingManifestSchema>;
type AudioSource={id:string;kind:'generated';sourceRef:ObjectRef;rightsRef:ObjectRef};

function revisionPrefix(projectId:string,revisionId:string){
 if(![projectId,revisionId].every(id=>z.uuid().safeParse(id).success))throw Error('NARRATION_PACKAGE_INVALID');
 return `projects/${projectId}/revisions/${revisionId}/`;
}
export async function readNarrationJson(store:AtomicStore,ref:ObjectRef,prefix:string):Promise<unknown>{
 if(!ObjectRefSchema.safeParse(ref).success||ref.mime!=='application/json'||ref.bytes<1||!ref.key.startsWith(prefix))throw Error('NARRATION_REF_CHANGED');
 try{
  const value=(await store.readFresh<unknown>(ref.key)).value;
  if(canonicalHash(value)!==ref.sha256||Buffer.byteLength(canonicalJson(value))!==ref.bytes)throw Error('NARRATION_REF_CHANGED');
  return value;
 }catch{throw Error('NARRATION_REF_CHANGED')}
}
async function readSafeVoice(path:string,base:string):Promise<{bytes:Buffer;wav:VoiceWavProbe}>{
 try{
  const baseReal=await realpath(base),fileReal=await realpath(path);
  if(!fileReal.startsWith(baseReal+'/'))throw Error('NARRATION_AUDIO_CHANGED');
  const file=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);
  try{
   const info=await file.stat();if(!info.isFile()||info.nlink!==1||info.size<44||info.size>20*1024*1024)throw Error('NARRATION_AUDIO_CHANGED');
   const bytes=await file.readFile();return{bytes,wav:probeVoiceWav(bytes)};
  }finally{await file.close()}
 }catch{throw Error('NARRATION_AUDIO_CHANGED')}
}
function assertWords(words:WordTimingManifest,source:Pick<NarrationSource,'lineId'|'wav'|'expectedAsrText'>){
 if(words.lineId!==source.lineId||words.voiceSha256!==source.wav.sha256)throw Error('NARRATION_ASR_CHANGED');
 assertAsrExpected(source.expectedAsrText,source.expectedAsrText,words.recognizedText);
 assertAsrExpected(words.recognizedText,words.recognizedText,words.words.map(word=>word.text).join(''));
 let end=0;
 for(const word of words.words){
  // Keep the recognizer's raw timestamps. The ASR runtime allows at most 1 s of boundary uncertainty.
  if(!word.text.trim()||word.startMs<end||word.endMs<=word.startMs||word.endMs>source.wav.durationMs+1000)throw Error('NARRATION_ASR_CHANGED');
  end=word.endMs;
 }
}
function timelineLine(source:NarrationSource):FilmTimeline['narration'][number]{
 const{lineId,displayText,spokenText,expectedAsrText,voiceConfigHash,audioRef,startSample,endSample,wordTimingsRef}=source;
 return{lineId,displayText,spokenText,expectedAsrText,voiceConfigHash,audioRef,startSample,endSample,wordTimingsRef};
}

export async function loadPackagedNarration(store:AtomicStore,root:string,projectId:string,revisionId:string,sourceRef:ObjectRef){
 if(!root||!isAbsolute(root))throw Error('NARRATION_DATA_DIR_REQUIRED');
 const prefix=revisionPrefix(projectId,revisionId),parsed=NarrationSourceSchema.safeParse(await readNarrationJson(store,sourceRef,`${prefix}narration-source/`));
 if(!parsed.success)throw Error('NARRATION_PACKAGE_INVALID');
 const source=parsed.data,expectedKey=`${prefix}audio-files/${source.wav.sha256}.wav`;
 if(source.audioRef.key!==expectedKey||source.audioRef.mime!=='audio/wav'||source.audioRef.bytes!==source.wav.bytes||source.audioRef.sha256!==source.wav.sha256||source.voiceConfigHash!==canonicalHash(source.voiceConfig)||source.endSample!==source.startSample+source.wav.samples*2||source.voiceConfig.voice!==(source.voiceConfig.language==='zh-CN'?'zf_001':'af_maple'))throw Error('NARRATION_AUDIO_CHANGED');
 const parsedWords=WordTimingManifestSchema.safeParse(await readNarrationJson(store,source.wordTimingsRef,`${prefix}narration-words/`));
 if(!parsedWords.success)throw Error('NARRATION_ASR_CHANGED');
 const words=parsedWords.data;assertWords(words,source);
 await runObjectHelper(root,'verify',expectedKey,source.audioRef.bytes);
 const actual=await readSafeVoice(join(root,'objects',expectedKey),join(root,'objects'));
 if(canonicalHash(actual.wav)!==canonicalHash(source.wav))throw Error('NARRATION_AUDIO_CHANGED');
 return{source,words,timelineLine:timelineLine(source)};
}

export async function runObjectHelper(root:string,mode:'publish'|'verify',key:string,bytes:number,body?:Buffer){
 const child=spawn(/* turbopackIgnore: true */ process.env.VIDEO_PYTHON_PATH||'python3',[join(process.cwd(),'runtime/storage/narration_object.py'),root,mode,key,String(bytes)],{stdio:['pipe','pipe','ignore'],signal:AbortSignal.timeout(30000)});
 let output='';child.stdout.on('data',(part:Buffer)=>{output+=part.toString('utf8');if(output.length>1024)child.kill()});
 child.stdin.on('error',()=>{});
 const code=await new Promise<number>((resolve,reject)=>{child.once('error',reject);child.once('close',code=>resolve(code??1));child.stdin.end(body)});
 if(code!==0||output.length>1024)throw Error('NARRATION_AUDIO_CHANGED');
 let response;try{response=JSON.parse(output)}catch{throw Error('NARRATION_AUDIO_CHANGED')}
 if(response.ok!==true)throw Error('NARRATION_AUDIO_CHANGED');
}

export async function archiveVerifiedNarration(projects:ProjectStore,root:string,projectId:string,revisionId:string,verified:VerifiedNarrationManifest,narration:TimingDraft['narration']):Promise<{lines:FilmTimeline['narration'];sources:AudioSource[]}>{
 if(!root||!isAbsolute(root))throw Error('NARRATION_DATA_DIR_REQUIRED');
 const prefix=revisionPrefix(projectId,revisionId),lines:FilmTimeline['narration']=[],sources:AudioSource[]=[];
 if(verified.lines.length!==narration.length||new Set(verified.lines.map(line=>line.lineId)).size!==verified.lines.length)throw Error('NARRATION_TIMING_CHANGED');
 for(const [index,line] of verified.lines.entries()){
  const timing=narration[index],voice=line.voice,asr=line.asr;
  if(line.asrStatus!=='pass'||line.wordTimingsStatus!=='available'||!asr||asr.voiceSha256!==voice.wav.sha256||line.lineId!==voice.lineId||line.language!==voice.language||line.durationMs!==voice.wav.durationMs||line.durationMs>line.reservedMs||line.startMs+line.reservedMs>verified.durationMs||timing.lineId!==line.lineId||timing.displayText!==line.displayText||timing.spokenText!==line.spokenText||timing.expectedAsrText!==line.expectedAsrText||timing.voiceSha256!==voice.wav.sha256||timing.voiceRuntimeDigest!==voice.runtimeDigest||timing.asrRuntimeDigest!==asr.runtimeDigest||timing.startSample!==line.startMs*48||timing.endSample!==timing.startSample+voice.wav.samples*2)throw Error('NARRATION_TIMING_CHANGED');
  const inside=relative(join(root,'voice'),voice.outputPath);
  if(!isAbsolute(voice.outputPath)||!inside||inside.startsWith('..')||isAbsolute(inside))throw Error('NARRATION_AUDIO_CHANGED');
  const actual=await readSafeVoice(voice.outputPath,join(root,'voice'));
  if(canonicalHash(actual.wav)!==canonicalHash(voice.wav))throw Error('NARRATION_AUDIO_CHANGED');
  const config=voiceConfig.parse({language:line.language,voice:voice.voice,provider:voice.provider,model:voice.model,modelLicense:voice.modelLicense,runtimeDigest:voice.runtimeDigest});
  const words=WordTimingManifestSchema.parse({schemaVersion:1,lineId:line.lineId,voiceSha256:actual.wav.sha256,asrModel:asr.model,asrRuntimeDigest:asr.runtimeDigest,recognizedText:line.recognizedText,words:line.wordTimings});
  const key=`${prefix}audio-files/${actual.wav.sha256}.wav`,audioRef:ObjectRef={key,sha256:actual.wav.sha256,bytes:actual.wav.bytes,mime:'audio/wav'};
  // Validate before writing any package reference. Model license is provenance, not a listening/rights QA pass.
  const candidate={schemaVersion:1 as const,kind:'generated_narration' as const,lineId:line.lineId,displayText:line.displayText,spokenText:line.spokenText,expectedAsrText:line.expectedAsrText,voiceConfig:config,voiceConfigHash:canonicalHash(config),audioRef,startSample:timing.startSample,endSample:timing.endSample,wav:actual.wav};
  NarrationSourceSchema.omit({wordTimingsRef:true}).parse(candidate);assertWords(words,candidate);
  await runObjectHelper(root,'publish',key,actual.bytes.length,actual.bytes);
  const source=NarrationSourceSchema.parse({...candidate,wordTimingsRef:await projects.index.immutable(`${prefix}narration-words`,words)});
  const sourceRef=await projects.index.immutable(`${prefix}narration-source`,source),rightsRef=await projects.index.immutable(`${prefix}narration-rights`,{basis:'generated',source:`${config.provider}; ${config.model}; voice=${config.voice}; modelLicense=${config.modelLicense}; runtime=${config.runtimeDigest}`});
  const loaded=await loadPackagedNarration(projects.store,root,projectId,revisionId,sourceRef);
  lines.push(loaded.timelineLine);sources.push({id:`voice-${line.lineId}`,kind:'generated',sourceRef,rightsRef});
 }
 return{lines,sources};
}
