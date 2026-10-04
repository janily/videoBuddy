import {createHash} from 'node:crypto';
import {join} from 'node:path';
import {z} from 'zod';
import {ObjectRefSchema,type ObjectRef} from '@/contracts/video/domain';
import type {ArchivedMessage,ProjectControl} from '@/contracts/video/project';
import {canonicalHash,canonicalJson} from '@/services/video/domain/hash';
import {createOrRead,StoreMissing,type AtomicStore} from '@/services/video/storage/atomic-store';
import {IndexStore} from '@/services/video/storage/index-store';
import type {ProjectStore} from '@/services/video/storage/project-store';
import {assertLiveProject} from '@/services/video/commands/user-activity';
import {assertAsrExpected} from '@/services/video/timeline/compile';
import type {AsrTranscript} from './asr';
import type {NarrationPlan} from './narration';
import {inspectVoiceWav} from './wav';
import {verifiedFilmHash,type PostMixFilm} from './postmix-asr';

const digest=z.string().regex(/^[a-f0-9]{64}$/);
const ChallengeSchema=z.strictObject({schemaVersion:z.literal(1),kind:z.literal('postmix_review_challenge'),projectId:z.uuid(),sourceRevisionId:z.uuid(),planSha256:digest,lineId:z.string().regex(/^[-a-zA-Z0-9_]{1,80}$/),language:z.enum(['zh-CN','en']),spokenText:z.string().min(1).max(250),displayText:z.string().min(1).max(500),expectedAsrText:z.string().min(1).max(500),filmSha256:digest,filmDurationMs:z.number().int().min(20000).max(120000),startMs:z.number().nonnegative(),lengthMs:z.number().min(200).max(30000),mediaRuntimeDigest:digest,mixedWavSha256:digest,transcriptSha256:digest,wordTimingsSha256:digest,recognizedText:z.string().min(1).max(2000),asrModel:z.string().regex(/^Systran\/faster-whisper-(?:small|medium)$/),asrRuntimeDigest:digest,scope:z.literal('single_postmix_wav')});
const ConfirmationSchema=z.strictObject({schemaVersion:z.literal(1),kind:z.literal('confirmed_postmix_review'),projectId:z.uuid(),challengeRef:ObjectRefSchema,sourceMessageRef:ObjectRefSchema,ownerKeyHash:z.string().min(1),consentEpoch:z.number().int().nonnegative(),decision:z.literal('pronunciation_correct'),confirmedAt:z.iso.datetime()});
const ownerActionSchema=z.strictObject({scope:z.literal('single_postmix_wav'),challengeSha256:digest,decision:z.literal('pronunciation_correct')});
function explicitMessage(message:ArchivedMessage,challengeRef:ObjectRef){
 if(message.role!=='user'||message.status!=='completed')return false;
 const action=ownerActionSchema.safeParse(message.speechReviewAction);
 // Only owner command handlers may attach this action; ordinary chat and Agent
 // output cannot supply it. Keep the actual wording of a human reply intact.
 return message.speechReviewAction===undefined?message.text==='读音正确，确认这句最终混音试听复核':action.success&&action.data.challengeSha256===challengeRef.sha256;
}
const authority=Symbol('loaded-owned-postmix-confirmation');
export type ConfirmedPostMixReview={readonly ref:ObjectRef;readonly challenge:z.infer<typeof ChallengeSchema>;readonly [authority]:true};
export interface PostMixReviewContext{film:PostMixFilm;plan:NarrationPlan;lineId:string;window:{startMs:number;lengthMs:number;mediaRuntimeDigest:string};transcript:AsrTranscript}
async function readRef(store:AtomicStore,ref:ObjectRef,prefix:string){
 if(!ObjectRefSchema.safeParse(ref).success||ref.mime!=='application/json'||!ref.key.startsWith(prefix))throw Error('POSTMIX_REVIEW_CHANGED');
 const value=(await store.readFresh(ref.key)).value;
 if(canonicalHash(value)!==ref.sha256||Buffer.byteLength(canonicalJson(value))!==ref.bytes)throw Error('POSTMIX_REVIEW_CHANGED');
 return value;
}
function contextBinding(context:PostMixReviewContext){
 const {film,plan,lineId,window,transcript}=context,line=plan.lines.find(item=>item.lineId===lineId);
 const nextStart=Math.min(film.durationMs,...plan.lines.filter(item=>line&&item.startMs>line.startMs).map(item=>item.startMs));
 if(!line||new Set(plan.lines.map(item=>item.lineId)).size!==plan.lines.length||plan.durationMs!==film.durationMs||window.startMs!==line.startMs||window.lengthMs>line.reservedMs+300||window.startMs+window.lengthMs>nextStart||transcript.language!==line.language)throw Error('POSTMIX_REVIEW_CHANGED');
 return {planSha256:canonicalHash(plan),lineId,language:line.language,spokenText:line.spokenText,displayText:line.displayText,expectedAsrText:line.expectedAsrText,filmSha256:film.sha256,filmDurationMs:film.durationMs,...window,mixedWavSha256:transcript.voiceSha256,transcriptSha256:canonicalHash(transcript),wordTimingsSha256:canonicalHash(transcript.segments.flatMap(segment=>segment.words)),recognizedText:transcript.recognizedText,asrModel:transcript.model,asrRuntimeDigest:transcript.runtimeDigest};
}
function checkedWords(context:PostMixReviewContext){
 const words=context.transcript.segments.flatMap(segment=>segment.words);
 if(!words.length||words.some((word,index)=>!word.text.trim()||!Number.isFinite(word.startMs)||!Number.isFinite(word.endMs)||word.startMs<0||word.endMs<=word.startMs||word.endMs>context.window.lengthMs+1000||index>0&&word.startMs<words[index-1].endMs))throw Error('ASR_TIMINGS_UNAVAILABLE');
 assertAsrExpected(context.transcript.recognizedText,context.transcript.recognizedText,words.map(word=>word.text).join(''));
 return words;
}
export async function createPostMixReviewChallenge(projects:ProjectStore,root:string,projectId:string,sourceRevisionId:string,context:PostMixReviewContext){
 if(![projectId,sourceRevisionId].every(id=>z.uuid().safeParse(id).success))throw Error('POSTMIX_REVIEW_CHANGED');
 assertLiveProject((await projects.store.readFresh<ProjectControl>(`projects/${projectId}/control`)).value);
 const binding=contextBinding(context);checkedWords(context);await verifiedFilmHash(root,context.film);
 const key=createHash('sha256').update(JSON.stringify([binding.filmSha256,binding.lineId,binding.language,binding.startMs,binding.lengthMs,binding.mediaRuntimeDigest,'postmix-v1'])).digest('hex');
 const wav=await inspectVoiceWav(join(root,'postmix',key,'output','line.wav'));
 if(wav.sha256!==binding.mixedWavSha256||Math.abs(wav.durationMs-binding.lengthMs)>2)throw Error('POSTMIX_REVIEW_CHANGED');
 let mismatch=false;try{assertAsrExpected(binding.expectedAsrText,binding.expectedAsrText,binding.recognizedText)}catch(error){if((error as Error).message!=='ASR_MISMATCH')throw error;mismatch=true}
 if(!mismatch)throw Error('POSTMIX_REVIEW_NOT_NEEDED');
 const challenge=ChallengeSchema.parse({schemaVersion:1,kind:'postmix_review_challenge',projectId,sourceRevisionId,...binding,scope:'single_postmix_wav'});
 return projects.index.immutable(`projects/${projectId}/postmix-review-challenges`,challenge);
}
/** Check the exact requested audio context before archiving an owner decision. */
export async function assertPostMixReviewChallenge(store:AtomicStore,projectId:string,challengeRef:ObjectRef,sourceRevisionId:string,context:PostMixReviewContext){
 const challenge=ChallengeSchema.parse(await readRef(store,challengeRef,`projects/${projectId}/postmix-review-challenges/`));
 const {schemaVersion,kind,projectId:storedProject,sourceRevisionId:storedRevision,scope,...binding}=challenge;
 void schemaVersion;void kind;void scope;
 if(storedProject!==projectId||storedRevision!==sourceRevisionId||canonicalHash(binding)!==canonicalHash(contextBinding(context)))throw Error('POSTMIX_REVIEW_CHANGED');
 checkedWords(context);
}
export async function confirmPostMixReview(projects:ProjectStore,owner:string,projectId:string,challengeRef:ObjectRef,sourceMessageId:string){
 const control=await projects.access(owner,projectId),prefix=`projects/${projectId}/`;
 const challenge=ChallengeSchema.parse(await readRef(projects.store,challengeRef,prefix+'postmix-review-challenges/'));
 if(challenge.projectId!==projectId)throw Error('POSTMIX_REVIEW_CHANGED');
 const entry=(await projects.index.all(control.messagesIndexRef)).find(item=>item.id===sourceMessageId);
 if(!entry)throw Error('POSTMIX_REVIEW_CONFIRMATION_REQUIRED');
 const message=await readRef(projects.store,entry.ref,prefix+'messages/') as ArchivedMessage;
 if(message.id!==sourceMessageId||!explicitMessage(message,challengeRef))throw Error('POSTMIX_REVIEW_CONFIRMATION_REQUIRED');
 const input={schemaVersion:1 as const,kind:'confirmed_postmix_review' as const,projectId,challengeRef,sourceMessageRef:entry.ref,ownerKeyHash:owner,consentEpoch:control.consentEpoch,decision:'pronunciation_correct' as const};
 // An explicit confirmation message can bind only one challenge. This is an
 // owned user action, never an Agent tool or an inference from ordinary chat.
 const record=ConfirmationSchema.parse(await createOrRead(projects.store,`${prefix}postmix-review-confirmations/${sourceMessageId}`,{...input,confirmedAt:new Date().toISOString()}));
 const {confirmedAt,...stored}=record;void confirmedAt;
 if(canonicalHash(stored)!==canonicalHash(input))throw Error('POSTMIX_REVIEW_CHANGED');
 const ref=await projects.index.immutable(prefix+'postmix-reviews',record);
 const lookup=await createOrRead(projects.store,lookupKey(projectId,control.consentEpoch,challenge),ref);
 if(canonicalHash(lookup)!==canonicalHash(ref))throw Error('POSTMIX_REVIEW_CHANGED');
 return ref;
}
export async function loadConfirmedPostMixReview(store:AtomicStore,projectId:string,ref:ObjectRef):Promise<ConfirmedPostMixReview>{
 if(!z.uuid().safeParse(projectId).success)throw Error('POSTMIX_REVIEW_CHANGED');
 const prefix=`projects/${projectId}/`,control=(await store.readFresh<ProjectControl>(prefix+'control')).value;assertLiveProject(control);
 const record=ConfirmationSchema.parse(await readRef(store,ref,prefix+'postmix-reviews/'));
 if(record.projectId!==projectId||record.ownerKeyHash!==control.ownerKeyHash||record.consentEpoch>control.consentEpoch)throw Error('POSTMIX_REVIEW_CHANGED');
 const challenge=ChallengeSchema.parse(await readRef(store,record.challengeRef,prefix+'postmix-review-challenges/'));
 const message=await readRef(store,record.sourceMessageRef,prefix+'messages/') as ArchivedMessage;
 if(challenge.projectId!==projectId||!z.uuid().safeParse(message.id).success||!explicitMessage(message,record.challengeRef))throw Error('POSTMIX_REVIEW_CONFIRMATION_REQUIRED');
 let slot:unknown;try{slot=(await store.readFresh(`${prefix}postmix-review-confirmations/${message.id}`)).value}catch(error){if(error instanceof StoreMissing)throw Error('POSTMIX_REVIEW_CHANGED');throw error}
 if(canonicalHash(ConfirmationSchema.parse(slot))!==canonicalHash(record))throw Error('POSTMIX_REVIEW_CHANGED');
 const entry=(await new IndexStore(store).all(control.messagesIndexRef)).find(item=>item.id===message.id);
 if(!entry||canonicalHash(entry.ref)!==canonicalHash(record.sourceMessageRef))throw Error('POSTMIX_REVIEW_CHANGED');
 return Object.freeze({ref:Object.freeze({...ref}),challenge:Object.freeze(challenge),[authority]:true as const});
}

export function verifyReviewedPostMixText(context:PostMixReviewContext,proof:ConfirmedPostMixReview){
 if(proof?.[authority]!==true)throw Error('POSTMIX_REVIEW_UNTRUSTED');
 const {schemaVersion,kind,projectId,sourceRevisionId,scope,...stored}=proof.challenge;
 void schemaVersion;void kind;void projectId;void sourceRevisionId;void scope;
 if(canonicalHash(stored)!==canonicalHash(contextBinding(context)))throw Error('POSTMIX_REVIEW_CHANGED');
 const words=checkedWords(context);
 let mismatch=false;try{assertAsrExpected(proof.challenge.expectedAsrText,proof.challenge.expectedAsrText,context.transcript.recognizedText)}catch(error){if((error as Error).message!=='ASR_MISMATCH')throw error;mismatch=true}
 if(!mismatch)throw Error('POSTMIX_REVIEW_NOT_NEEDED');
 return {status:'trusted_review' as const,model:context.transcript.model,voiceSha256:context.transcript.voiceSha256,recognizedText:context.transcript.recognizedText,words,speechReviewRef:proof.ref};
}

function lookupKey(projectId:string,consentEpoch:number,challenge:Pick<ConfirmedPostMixReview['challenge'],'filmSha256'|'planSha256'|'lineId'|'startMs'|'lengthMs'|'mediaRuntimeDigest'|'mixedWavSha256'|'transcriptSha256'>){
 const {filmSha256,planSha256,lineId,startMs,lengthMs,mediaRuntimeDigest,mixedWavSha256,transcriptSha256}=challenge;
 return `projects/${projectId}/postmix-review-lookup/${canonicalHash({consentEpoch,filmSha256,planSha256,lineId,startMs,lengthMs,mediaRuntimeDigest,mixedWavSha256,transcriptSha256})}`;
}
export async function findConfirmedPostMixReview(store:AtomicStore,projectId:string,context:PostMixReviewContext){
 const control=(await store.readFresh<ProjectControl>(`projects/${projectId}/control`)).value;assertLiveProject(control);
 let ref:ObjectRef;try{ref=(await store.readFresh<ObjectRef>(lookupKey(projectId,control.consentEpoch,contextBinding(context)))).value}catch(error){if(error instanceof StoreMissing)return;throw error}
 const proof=await loadConfirmedPostMixReview(store,projectId,ref);verifyReviewedPostMixText(context,proof);return proof;
}
