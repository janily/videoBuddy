import {isAbsolute,join,relative} from 'node:path';
import {z} from 'zod';
import type {ObjectRef,Understanding} from '@/contracts/video/domain';
import type {ProjectControl} from '@/contracts/video/project';
import {type NarrationPlan,prepareNarration} from '@/services/video/audio/narration';
import {asrConfiguration,transcribeVoice,verifyNarration,type AsrTranscript,type VerifiedNarrationManifest} from '@/services/video/audio/asr';
import {synthesizeVoice,voiceConfiguration,type VoiceJob,type VoiceResult} from '@/services/video/audio/voice';
import {inspectVoiceWav} from '@/services/video/audio/wav';
import type {Environment} from '@/services/video/config/environment';
import {canonicalHash,canonicalJson} from '@/services/video/domain/hash';
import {createOrRead,StoreMissing} from '@/services/video/storage/atomic-store';
import type {ProjectStore} from '@/services/video/storage/project-store';
import {assertPreviewProductionFence} from './fence';
import {compileVoicePlan} from './voice-plan';

type Generate=(root:string,job:VoiceJob)=>Promise<VoiceResult>;
type Recognize=(root:string,voice:VoiceResult)=>Promise<AsrTranscript>;
interface Options{root?:string;env?:Environment;generate?:Generate;recognize?:Recognize;mustExist?:boolean}
export interface VoiceStageRecord{schemaVersion:1;briefVersion:number;understandingSha256:string;treatmentSha256:string;planRef:ObjectRef;verifiedRef:ObjectRef}

async function readRef<T>(projects:ProjectStore,ref:ObjectRef,prefix:string):Promise<T>{
 if(ref.mime!=='application/json'||!ref.key.startsWith(prefix)||ref.bytes<1)throw Error('VOICE_STAGE_REF_CHANGED');
 let value:T;try{value=(await projects.store.readFresh<T>(ref.key)).value}catch{throw Error('VOICE_STAGE_REF_CHANGED')}
 try{if(canonicalHash(value)!==ref.sha256||Buffer.byteLength(canonicalJson(value))!==ref.bytes)throw Error('VOICE_STAGE_REF_CHANGED')}catch{throw Error('VOICE_STAGE_REF_CHANGED')}
 return value;
}
async function assertVoiceFiles(root:string,verified:VerifiedNarrationManifest){
 for(const line of verified.lines){
  const path=line.voice.outputPath,inside=relative(join(root,'voice'),path);
  if(!isAbsolute(path)||inside.startsWith('..')||isAbsolute(inside)||!inside||line.asrStatus!=='pass'||line.wordTimingsStatus!=='available')throw Error('VOICE_SOURCE_CHANGED');
  let actual;try{actual=await inspectVoiceWav(path)}catch{throw Error('VOICE_SOURCE_CHANGED')}
  if(canonicalHash(actual)!==canonicalHash(line.voice.wav))throw Error('VOICE_SOURCE_CHANGED');
 }
}
function assertManifest(plan:NarrationPlan,verified:VerifiedNarrationManifest){
 if(verified.durationMs!==plan.durationMs||verified.lines.length!==plan.lines.length)throw Error('VOICE_STAGE_REF_CHANGED');
 for(const [index,line] of verified.lines.entries()){
  const expected=plan.lines[index];
  if(line.lineId!==expected.lineId||line.language!==expected.language||line.spokenText!==expected.spokenText||line.displayText!==expected.displayText||line.expectedAsrText!==expected.expectedAsrText||line.startMs!==expected.startMs||line.reservedMs!==expected.reservedMs||line.durationMs<=0||line.durationMs>line.reservedMs||line.asrStatus!=='pass'||line.wordTimingsStatus!=='available'||line.wordTimings.length===0||line.asr?.voiceSha256!==line.voice.wav.sha256||line.asr.model!=='Systran/faster-whisper-small'||!/^([a-f0-9]{64})$/.test(line.asr.runtimeDigest))throw Error('VOICE_STAGE_REF_CHANGED');
 }
}

export async function prepareVoiceStage(projects:ProjectStore,projectId:string,revisionId:string,operationId:string,expectedConsentEpoch:number,treatmentRef:ObjectRef,options:Options={}):Promise<VoiceStageRecord>{
 if(![projectId,revisionId,operationId].every(id=>z.uuid().safeParse(id).success)||!Number.isSafeInteger(expectedConsentEpoch)||expectedConsentEpoch<0)throw Error('VALIDATION_FAILED');
 const prefix=`projects/${projectId}`,revisionPrefix=`${prefix}/revisions/${revisionId}/`,control=(await projects.store.readFresh<ProjectControl>(`${prefix}/control`)).value;
 assertPreviewProductionFence(control,projectId,operationId,expectedConsentEpoch);
 const understanding=await readRef<Understanding>(projects,control.understandingRef,`${prefix}/understanding/`);
 if(understanding.briefVersion!==control.briefVersion)throw Error('TREATMENT_BASELINE_CHANGED');
 if(!treatmentRef.key.startsWith(`${revisionPrefix}treatment-plan/`))throw Error('VOICE_STAGE_REF_CHANGED');
 const treatment=await readRef<unknown>(projects,treatmentRef,revisionPrefix),plan=compileVoicePlan(treatment,understanding);
 const env=options.env||process.env,root=options.root||env.VIDEO_DATA_DIR;
 if(!root||!isAbsolute(root))throw Error('CONFIGURATION_REQUIRED: VIDEO_DATA_DIR');
 const key=`${revisionPrefix}voice-stage`,matching=(record:VoiceStageRecord)=>record.schemaVersion===1&&record.briefVersion===control.briefVersion&&record.understandingSha256===control.understandingRef.sha256&&record.treatmentSha256===treatmentRef.sha256;
 let existing:VoiceStageRecord|undefined;
 try{existing=(await projects.store.readFresh<VoiceStageRecord>(key)).value}catch(error){if(!(error instanceof StoreMissing))throw error}
 if(existing){
  if(!matching(existing))throw Error('VOICE_STAGE_CONFLICT');
  const [storedPlan,verified]=await Promise.all([readRef<NarrationPlan>(projects,existing.planRef,revisionPrefix),readRef<VerifiedNarrationManifest>(projects,existing.verifiedRef,revisionPrefix)]);
  if(canonicalHash(storedPlan)!==canonicalHash(plan))throw Error('VOICE_STAGE_CONFLICT');
  assertManifest(storedPlan,verified);await assertVoiceFiles(root,verified);
  const latest=(await projects.store.readFresh<ProjectControl>(`${prefix}/control`)).value;
  assertPreviewProductionFence(latest,projectId,operationId,expectedConsentEpoch,{briefVersion:control.briefVersion,understandingRef:control.understandingRef});
  return existing;
 }
 if(options.mustExist)throw Error('VOICE_STAGE_MISSING');
 if(plan.lines.length){if(!options.generate)voiceConfiguration(env);if(!options.recognize)asrConfiguration(env)}
 const prepared=await prepareNarration(plan,root,options.generate||((dir,job)=>synthesizeVoice(dir,job,env)));
 const verified=await verifyNarration(plan,prepared,root,options.recognize||((dir,voice)=>transcribeVoice(dir,voice,env)));
 assertManifest(plan,verified);await assertVoiceFiles(root,verified);
 const latest=(await projects.store.readFresh<ProjectControl>(`${prefix}/control`)).value;
 assertPreviewProductionFence(latest,projectId,operationId,expectedConsentEpoch,{briefVersion:control.briefVersion,understandingRef:control.understandingRef});
 const record:VoiceStageRecord={schemaVersion:1,briefVersion:control.briefVersion,understandingSha256:control.understandingRef.sha256,treatmentSha256:treatmentRef.sha256,
  planRef:await projects.index.immutable(`${revisionPrefix}voice-plan`,plan),verifiedRef:await projects.index.immutable(`${revisionPrefix}voice-verified`,verified)};
 const stored=await createOrRead(projects.store,key,record);
 if(canonicalHash(stored)!==canonicalHash(record))throw Error('VOICE_STAGE_CONFLICT');
 return record;
}
