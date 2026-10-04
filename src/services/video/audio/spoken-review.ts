import {isAbsolute,join,relative} from 'node:path';
import {z} from 'zod';
import {ObjectRefSchema,type ObjectRef} from '@/contracts/video/domain';
import type {ArchivedMessage,ProjectControl} from '@/contracts/video/project';
import {canonicalHash,canonicalJson} from '@/services/video/domain/hash';
import {createOrRead,StoreMissing,type AtomicStore} from '@/services/video/storage/atomic-store';
import {IndexStore} from '@/services/video/storage/index-store';
import type {ProjectStore} from '@/services/video/storage/project-store';
import {assertLiveProject} from '@/services/video/commands/user-activity';
import {assertAsrExpected} from '@/services/video/timeline/compile';
import type {AsrTranscript,VerifiedNarrationManifest} from './asr';
import type {NarrationPlan} from './narration';
import type {VoiceResult} from './voice';
import {inspectVoiceWav} from './wav';

const digest=z.string().regex(/^[a-f0-9]{64}$/);
const ChallengeSchema=z.strictObject({schemaVersion:z.literal(1),kind:z.literal('speech_review_challenge'),projectId:z.uuid(),sourceRevisionId:z.uuid(),planSha256:digest,lineId:z.string().regex(/^[-a-zA-Z0-9_]{1,80}$/),language:z.enum(['zh-CN','en']),spokenText:z.string().min(1).max(250),displayText:z.string().min(1).max(500),expectedAsrText:z.string().min(1).max(500),voiceSha256:digest,voiceRuntimeDigest:digest,transcriptSha256:digest,wordTimingsSha256:digest,recognizedText:z.string().min(1).max(2000),asrModel:z.string().regex(/^Systran\/faster-whisper-(?:small|medium)$/),asrRuntimeDigest:digest,scope:z.literal('single_original_wav')});
const ConfirmationSchema=z.strictObject({schemaVersion:z.literal(1),kind:z.literal('confirmed_speech_review'),projectId:z.uuid(),challengeRef:ObjectRefSchema,sourceMessageRef:ObjectRefSchema,ownerKeyHash:z.string().min(1),consentEpoch:z.number().int().nonnegative(),decision:z.literal('pronunciation_correct'),confirmedAt:z.iso.datetime()});
const authority=Symbol('loaded-owned-speech-confirmation');
export type ConfirmedSpeechReview={readonly ref:ObjectRef;readonly challenge:z.infer<typeof ChallengeSchema>;readonly [authority]:true};

async function readRef(store:AtomicStore,ref:ObjectRef,prefix:string){
 if(!ObjectRefSchema.safeParse(ref).success||ref.mime!=='application/json'||!ref.key.startsWith(prefix))throw Error('SPEECH_REVIEW_CHANGED');
 const value=(await store.readFresh(ref.key)).value;
 if(canonicalHash(value)!==ref.sha256||Buffer.byteLength(canonicalJson(value))!==ref.bytes)throw Error('SPEECH_REVIEW_CHANGED');
 return value;
}
export async function createSpeechReviewChallenge(projects:ProjectStore,root:string,projectId:string,sourceRevisionId:string,plan:NarrationPlan,lineId:string,voice:VoiceResult,transcript:AsrTranscript){
 if(![projectId,sourceRevisionId].every(id=>z.uuid().safeParse(id).success))throw Error('SPEECH_REVIEW_CHANGED');
 const control=(await projects.store.readFresh<ProjectControl>(`projects/${projectId}/control`)).value;assertLiveProject(control);
 const line=plan.lines.find(item=>item.lineId===lineId),inside=relative(join(root,'voice'),voice.outputPath);
 if(!line||!isAbsolute(root)||!isAbsolute(voice.outputPath)||inside.startsWith('..')||isAbsolute(inside)||voice.lineId!==lineId||voice.language!==line.language||transcript.language!==line.language||transcript.voiceSha256!==voice.wav.sha256)throw Error('SPEECH_REVIEW_CHANGED');
 if(canonicalHash(await inspectVoiceWav(voice.outputPath))!==canonicalHash(voice.wav))throw Error('SPEECH_REVIEW_CHANGED');
 const words=transcript.segments.flatMap(segment=>segment.words);
 if(!words.length||words.some((word,index)=>!word.text.trim()||word.endMs<=word.startMs||word.endMs>voice.wav.durationMs+1000||index>0&&word.startMs<words[index-1].endMs))throw Error('ASR_TIMINGS_UNAVAILABLE');
 assertAsrExpected(transcript.recognizedText,transcript.recognizedText,words.map(word=>word.text).join(''));
 let mismatch=false;try{assertAsrExpected(line.expectedAsrText,line.expectedAsrText,transcript.recognizedText)}catch(error){if((error as Error).message!=='ASR_MISMATCH')throw error;mismatch=true}
 if(!mismatch)throw Error('SPEECH_REVIEW_NOT_NEEDED');
 const challenge=ChallengeSchema.parse({schemaVersion:1,kind:'speech_review_challenge',projectId,sourceRevisionId,planSha256:canonicalHash(plan),lineId,language:line.language,spokenText:line.spokenText,displayText:line.displayText,expectedAsrText:line.expectedAsrText,voiceSha256:voice.wav.sha256,voiceRuntimeDigest:voice.runtimeDigest,transcriptSha256:canonicalHash(transcript),wordTimingsSha256:canonicalHash(transcript.segments.flatMap(segment=>segment.words)),recognizedText:transcript.recognizedText,asrModel:transcript.model,asrRuntimeDigest:transcript.runtimeDigest,scope:'single_original_wav'});
 return projects.index.immutable(`projects/${projectId}/speech-review-challenges`,challenge);
}
export async function confirmSpeechReview(projects:ProjectStore,owner:string,projectId:string,challengeRef:ObjectRef,sourceMessageId:string){
 const control=await projects.access(owner,projectId),prefix=`projects/${projectId}/`;
 const challenge=ChallengeSchema.parse(await readRef(projects.store,challengeRef,prefix+'speech-review-challenges/'));
 if(challenge.projectId!==projectId)throw Error('SPEECH_REVIEW_CHANGED');
 const entry=(await projects.index.all(control.messagesIndexRef)).find(item=>item.id===sourceMessageId);
 if(!entry)throw Error('SPEECH_REVIEW_CONFIRMATION_REQUIRED');
 const message=await readRef(projects.store,entry.ref,prefix+'messages/') as ArchivedMessage;
 if(message.id!==sourceMessageId||message.role!=='user'||message.status!=='completed'||message.text!=='读音正确，确认这句试听复核')throw Error('SPEECH_REVIEW_CONFIRMATION_REQUIRED');
 const input={schemaVersion:1 as const,kind:'confirmed_speech_review' as const,projectId,challengeRef,sourceMessageRef:entry.ref,ownerKeyHash:owner,consentEpoch:control.consentEpoch,decision:'pronunciation_correct' as const};
 // An explicit confirmation message can bind only one challenge. This is an
 // owned user action, never an Agent tool or an inference from ordinary chat.
 const record=ConfirmationSchema.parse(await createOrRead(projects.store,`${prefix}speech-review-confirmations/${sourceMessageId}`,{...input,confirmedAt:new Date().toISOString()}));
 const {confirmedAt,...stored}=record;void confirmedAt;
 if(canonicalHash(stored)!==canonicalHash(input))throw Error('SPEECH_REVIEW_CHANGED');
 const ref=await projects.index.immutable(prefix+'speech-reviews',record);
 const key=reviewLookupKey(projectId,control.consentEpoch,challenge);
 const storedRef=await createOrRead(projects.store,key,ref);
 if(canonicalHash(storedRef)!==canonicalHash(ref))throw Error('SPEECH_REVIEW_CHANGED');
 return ref;
}
export async function loadConfirmedSpeechReview(store:AtomicStore,projectId:string,ref:ObjectRef):Promise<ConfirmedSpeechReview>{
 if(!z.uuid().safeParse(projectId).success)throw Error('SPEECH_REVIEW_CHANGED');
 const prefix=`projects/${projectId}/`,control=(await store.readFresh<ProjectControl>(prefix+'control')).value;assertLiveProject(control);
 const record=ConfirmationSchema.parse(await readRef(store,ref,prefix+'speech-reviews/'));
 if(record.projectId!==projectId||record.ownerKeyHash!==control.ownerKeyHash||record.consentEpoch>control.consentEpoch)throw Error('SPEECH_REVIEW_CHANGED');
 const challenge=ChallengeSchema.parse(await readRef(store,record.challengeRef,prefix+'speech-review-challenges/'));
 const message=await readRef(store,record.sourceMessageRef,prefix+'messages/') as ArchivedMessage;
 if(challenge.projectId!==projectId||!z.uuid().safeParse(message.id).success||message.role!=='user'||message.status!=='completed'||message.text!=='读音正确，确认这句试听复核')throw Error('SPEECH_REVIEW_CONFIRMATION_REQUIRED');
 let slot:unknown;try{slot=(await store.readFresh(`${prefix}speech-review-confirmations/${message.id}`)).value}catch(error){if(error instanceof StoreMissing)throw Error('SPEECH_REVIEW_CHANGED');throw error}
 if(canonicalHash(ConfirmationSchema.parse(slot))!==canonicalHash(record))throw Error('SPEECH_REVIEW_CHANGED');
 const entry=(await new IndexStore(store).all(control.messagesIndexRef)).find(item=>item.id===message.id);
 if(!entry||canonicalHash(entry.ref)!==canonicalHash(record.sourceMessageRef))throw Error('SPEECH_REVIEW_CHANGED');
 return Object.freeze({ref:Object.freeze({...ref}),challenge:Object.freeze(challenge),[authority]:true as const});
}
export function assertSpeechReview(originalExpected:string,transcript:AsrTranscript,proof:ConfirmedSpeechReview){
 if(proof?.[authority]!==true)throw Error('SPEECH_REVIEW_UNTRUSTED');
 const c=proof.challenge;
 if(c.expectedAsrText!==originalExpected||c.voiceSha256!==transcript.voiceSha256||c.transcriptSha256!==canonicalHash(transcript)||c.recognizedText!==transcript.recognizedText||c.language!==transcript.language||c.asrModel!==transcript.model||c.asrRuntimeDigest!==transcript.runtimeDigest)throw Error('SPEECH_REVIEW_CHANGED');
}

export function assertSpeechReviewLine(proof:ConfirmedSpeechReview,line:Pick<NarrationPlan['lines'][number],'lineId'|'language'|'spokenText'|'displayText'|'expectedAsrText'>,voiceRuntimeDigest:string,planSha256:string){
 if(proof?.[authority]!==true)throw Error('SPEECH_REVIEW_UNTRUSTED');
 const c=proof.challenge;
 if(c.planSha256!==planSha256||c.lineId!==line.lineId||c.language!==line.language||c.spokenText!==line.spokenText||c.displayText!==line.displayText||c.expectedAsrText!==line.expectedAsrText||c.voiceRuntimeDigest!==voiceRuntimeDigest)throw Error('SPEECH_REVIEW_CHANGED');
}

function reviewLookupKey(projectId:string,consentEpoch:number,c:Pick<ConfirmedSpeechReview['challenge'],'planSha256'|'lineId'|'voiceSha256'|'voiceRuntimeDigest'|'transcriptSha256'>){
 return `projects/${projectId}/speech-review-lookup/${canonicalHash({consentEpoch,planSha256:c.planSha256,lineId:c.lineId,voiceSha256:c.voiceSha256,voiceRuntimeDigest:c.voiceRuntimeDigest,transcriptSha256:c.transcriptSha256})}`;
}
export async function findConfirmedSpeechReview(store:AtomicStore,projectId:string,plan:NarrationPlan,line:NarrationPlan['lines'][number],voice:VoiceResult,transcript:AsrTranscript){
 const control=(await store.readFresh<ProjectControl>(`projects/${projectId}/control`)).value;assertLiveProject(control);
 const key=reviewLookupKey(projectId,control.consentEpoch,{planSha256:canonicalHash(plan),lineId:line.lineId,voiceSha256:voice.wav.sha256,voiceRuntimeDigest:voice.runtimeDigest,transcriptSha256:canonicalHash(transcript)});
 let ref:ObjectRef;try{ref=(await store.readFresh<ObjectRef>(key)).value}catch(error){if(error instanceof StoreMissing)return;throw error}
 const proof=await loadConfirmedSpeechReview(store,projectId,ref);
 assertSpeechReviewLine(proof,line,voice.runtimeDigest,canonicalHash(plan));assertSpeechReview(line.expectedAsrText,transcript,proof);
 return proof;
}
export async function assertVerifiedSpeechReview(store:AtomicStore,projectId:string,plan:NarrationPlan,line:VerifiedNarrationManifest['lines'][number]){
 if(line.asrStatus==='pass'){if(line.speechReview)throw Error('SPEECH_REVIEW_CHANGED');return}
 if(line.asrStatus!=='trusted_review'||!line.speechReview)throw Error('SPEECH_REVIEW_CHANGED');
 const {ref,planSha256,transcript}=line.speechReview,proof=await loadConfirmedSpeechReview(store,projectId,ref);
 if(planSha256!==canonicalHash(plan)||line.recognizedText!==transcript.recognizedText||line.voice.wav.sha256!==transcript.voiceSha256||line.asr.model!==transcript.model||line.asr.runtimeDigest!==transcript.runtimeDigest||canonicalHash(line.wordTimings)!==proof.challenge.wordTimingsSha256)throw Error('SPEECH_REVIEW_CHANGED');
 assertSpeechReviewLine(proof,line,line.voice.runtimeDigest,planSha256);assertSpeechReview(line.expectedAsrText,transcript,proof);
}

export async function speechReviewExportAudit(store:AtomicStore,projectId:string,ref:ObjectRef){
 const proof=await loadConfirmedSpeechReview(store,projectId,ref);
 const record=ConfirmationSchema.parse(await readRef(store,ref,`projects/${projectId}/speech-reviews/`));
 // This portable audit describes the already reviewed WAV. It deliberately
 // cannot be loaded as an authorization capability or private confirmation.
 return {...proof.challenge,kind:'speech_review_export_audit' as const,authority:'project_owner_explicit_listening_review' as const,decision:record.decision,confirmedAt:record.confirmedAt,confirmationSha256:ref.sha256,privateConfirmationIncluded:false as const};
}
