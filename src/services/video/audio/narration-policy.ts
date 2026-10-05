import {postMixExtractionKey} from './postmix-extraction';
import {verifiedFilmHash} from './postmix-asr';
import {realpath} from 'node:fs/promises';
import {join} from 'node:path';
import {z} from 'zod';
import {ObjectRefSchema,type ObjectRef} from '@/contracts/video/domain';
import type {ArchivedMessage,ProjectControl} from '@/contracts/video/project';
import {canonicalHash} from '../domain/hash';
import {createOrRead,StoreMissing} from '../storage/atomic-store';
import type {ProjectStore} from '../storage/project-store';
import {assertLiveProject} from '../commands/user-activity';
import {readNarrationJson} from './narration-package';
import type {NarrationPlan} from './narration';
import {verifySpokenText,type VerifiedNarrationManifest} from './asr';
import {assertVerifiedSpeechReview} from './spoken-review';
import {inspectVoiceWav} from './wav';
import type {PostMixReviewContext} from './postmix-review';

const digest=z.string().regex(/^[a-f0-9]{64}$/);
export const NarrationPolicyActionSchema=z.strictObject({scope:z.literal('same_verified_narration'),planSha256:digest,verifiedSha256:digest,decision:z.literal('reuse_pronunciation_without_repeated_listening')});
const schema=z.strictObject({schemaVersion:z.literal(1),kind:z.literal('owner_narration_reuse_policy'),projectId:z.uuid(),ownerKeyHash:z.string().min(1),consentEpoch:z.number().int().nonnegative(),sourceRevisionId:z.uuid(),planRef:ObjectRefSchema,verifiedRef:ObjectRefSchema,sourceMessageRef:ObjectRefSchema,confirmedAt:z.iso.datetime()});
const authority=Symbol('owned-narration-reuse-policy');
export type NarrationPolicyProof={readonly kind:'owner_narration_reuse_policy';readonly ref:ObjectRef;readonly contextSha256:string;readonly [authority]:true};

/** Allow bounded recognition substitutions, never dropped/added speech. The raw
 * transcript stays untouched and the result is an owner waiver, not ASR pass. */
export function assertPolicyRecognition(expected:string,recognized:string){
 const tokens=(text:string)=>text.normalize('NFKC').toLowerCase().match(/[\p{Script=Han}]|[\p{L}\p{N}]+/gu)||[];
 const a=tokens(expected),b=tokens(recognized);
 if(!a.length||a.length!==b.length||a.filter((word,i)=>word!==b[i]).length>Math.max(1,Math.floor(a.length/10)))throw Error('NARRATION_POLICY_RECOGNITION_CHANGED');
}
export async function validateNarrationPolicySource(projects:ProjectStore,root:string,projectId:string,revisionId:string,planRef:ObjectRef,verifiedRef:ObjectRef){
 if(![projectId,revisionId].every(id=>z.uuid().safeParse(id).success))throw Error('NARRATION_POLICY_CHANGED');
 const prefix=`projects/${projectId}/revisions/${revisionId}/`;
 const plan=await readNarrationJson(projects.store,planRef,prefix+'voice-plan/') as NarrationPlan,verified=await readNarrationJson(projects.store,verifiedRef,prefix+'voice-verified/') as VerifiedNarrationManifest;
 if(!plan.lines.length||plan.durationMs!==verified.durationMs||plan.lines.length!==verified.lines.length||new Set(plan.lines.map(l=>l.lineId)).size!==plan.lines.length||new Set(verified.lines.map(l=>l.lineId)).size!==verified.lines.length)throw Error('NARRATION_POLICY_CHANGED');
 const base=await realpath(join(root,'voice'));
 for(const line of verified.lines){
  const original=plan.lines.find(l=>l.lineId===line.lineId);
  if(!original||Object.entries(original).some(([k,v])=>line[k as keyof typeof line]!==v)||line.durationMs<=0||line.durationMs>line.reservedMs||line.wordTimingsStatus!=='available'||line.voice.lineId!==line.lineId||line.voice.language!==line.language||line.asr.voiceSha256!==line.voice.wav.sha256||line.durationMs!==line.voice.wav.durationMs)throw Error('NARRATION_POLICY_CHANGED');
  const path=await realpath(line.voice.outputPath);if(!path.startsWith(base+'/'))throw Error('NARRATION_POLICY_CHANGED');
  if(canonicalHash(await inspectVoiceWav(line.voice.outputPath))!==canonicalHash(line.voice.wav))throw Error('NARRATION_POLICY_CHANGED');
  await assertVerifiedSpeechReview(projects.store,projectId,plan,line);
  if(line.asrStatus==='pass')verifySpokenText(line.expectedAsrText,line.expectedAsrText,{language:line.language,model:line.asr.model,runtimeDigest:line.asr.runtimeDigest,voiceSha256:line.asr.voiceSha256,recognizedText:line.recognizedText,segments:[{text:line.recognizedText,startMs:0,endMs:line.durationMs,words:line.wordTimings}]},undefined,line.asr.recognitionPolicy);
 }
 return{plan,verified};
}
export function narrationPolicyIdentity(verified:VerifiedNarrationManifest){return canonicalHash({...verified,lines:verified.lines.map(line=>{const {outputPath,...voice}=line.voice;void outputPath;return {...line,voice}})})}
function lookup(projectId:string,epoch:number,planSha:string,verifiedSha:string){return `projects/${projectId}/narration-policy-lookup/${canonicalHash({epoch,planSha,verifiedSha})}`}
async function message(projects:ProjectStore,control:ProjectControl,ref:ObjectRef,planRef:ObjectRef,verifiedRef:ObjectRef){
 const entry=(await projects.index.all(control.messagesIndexRef)).find(item=>canonicalHash(item.ref)===canonicalHash(ref));
 if(!entry)throw Error('NARRATION_POLICY_CONFIRMATION_REQUIRED');
 const m=await readNarrationJson(projects.store,ref,`projects/${control.projectId}/messages/`) as ArchivedMessage,action=NarrationPolicyActionSchema.parse(m.narrationPolicyAction);
 if(entry.id!==m.id||m.role!=='user'||m.status!=='completed'||!m.text.trim()||action.planSha256!==planRef.sha256||action.verifiedSha256!==verifiedRef.sha256)throw Error('NARRATION_POLICY_CONFIRMATION_REQUIRED');
 return m;
}
export async function confirmNarrationReusePolicy(projects:ProjectStore,root:string,owner:string,projectId:string,sourceRevisionId:string,planRef:ObjectRef,verifiedRef:ObjectRef,messageId:string){
 const control=await projects.access(owner,projectId);
 const checked=await validateNarrationPolicySource(projects,root,projectId,sourceRevisionId,planRef,verifiedRef);
 const entry=(await projects.index.all(control.messagesIndexRef)).find(item=>item.id===messageId);if(!entry)throw Error('NARRATION_POLICY_CONFIRMATION_REQUIRED');
 await message(projects,control,entry.ref,planRef,verifiedRef);
 const input={schemaVersion:1 as const,kind:'owner_narration_reuse_policy' as const,projectId,sourceRevisionId,ownerKeyHash:owner,consentEpoch:control.consentEpoch,planRef,verifiedRef,sourceMessageRef:entry.ref};
 const record=schema.parse(await createOrRead(projects.store,`projects/${projectId}/narration-policy-confirmations/${messageId}`,{...input,confirmedAt:new Date().toISOString()}));
 const {confirmedAt,...stored}=record;void confirmedAt;if(canonicalHash(stored)!==canonicalHash(input))throw Error('NARRATION_POLICY_CHANGED');
 const ref=await projects.index.immutable(`projects/${projectId}/narration-policies`,record),existing=await createOrRead(projects.store,lookup(projectId,control.consentEpoch,planRef.sha256,narrationPolicyIdentity(checked.verified)),ref);
 if(canonicalHash(existing)!==canonicalHash(ref))throw Error('NARRATION_POLICY_CHANGED');return ref;
}
export async function findNarrationPolicyReview(projects:ProjectStore,root:string,projectId:string,plan:NarrationPlan,verified:VerifiedNarrationManifest,context:PostMixReviewContext):Promise<NarrationPolicyProof|undefined>{
 const control=(await projects.store.readFresh<ProjectControl>(`projects/${projectId}/control`)).value;assertLiveProject(control);
 let ref:ObjectRef;try{ref=(await projects.store.readFresh<ObjectRef>(lookup(projectId,control.consentEpoch,canonicalHash(plan),narrationPolicyIdentity(verified)))).value}catch(error){if(error instanceof StoreMissing)return;throw error}
 const record=schema.parse(await readNarrationJson(projects.store,ref,`projects/${projectId}/narration-policies/`));
 if(record.projectId!==projectId||record.ownerKeyHash!==control.ownerKeyHash||record.consentEpoch!==control.consentEpoch||record.planRef.sha256!==canonicalHash(plan)||canonicalHash(context.plan)!==canonicalHash(plan))throw Error('NARRATION_POLICY_CHANGED');
 const m=await message(projects,control,record.sourceMessageRef,record.planRef,record.verifiedRef),slot=schema.parse((await projects.store.readFresh(`projects/${projectId}/narration-policy-confirmations/${m.id}`)).value);
 if(canonicalHash(slot)!==canonicalHash(record))throw Error('NARRATION_POLICY_CHANGED');
 const original=await validateNarrationPolicySource(projects,root,projectId,record.sourceRevisionId,record.planRef,record.verifiedRef);
 if(narrationPolicyIdentity(original.verified)!==narrationPolicyIdentity(verified))throw Error('NARRATION_POLICY_CHANGED');
 verifyNarrationPolicyContext(context,verified);
 await verifiedFilmHash(root,context.film);
 const key=postMixExtractionKey(context.film.sha256,context.lineId,context.transcript.language,context.window);
 const mixed=await inspectVoiceWav(join(root,'postmix',key,'output','line.wav'));
 if(mixed.sha256!==context.transcript.voiceSha256||Math.abs(mixed.durationMs-context.window.lengthMs)>2)throw Error('NARRATION_POLICY_CHANGED');
 return Object.freeze({kind:'owner_narration_reuse_policy' as const,ref:Object.freeze({...ref}),contextSha256:canonicalHash(context),[authority]:true as const});
}
function verifyNarrationPolicyContext(context:PostMixReviewContext,verified:VerifiedNarrationManifest){
 const line=verified.lines.find(l=>l.lineId===context.lineId),words=context.transcript.segments.flatMap(s=>s.words);
 if(!line||context.film.durationMs!==verified.durationMs||context.window.startMs!==line.startMs||context.window.lengthMs<line.durationMs||context.window.lengthMs>line.durationMs+300||context.transcript.language!==line.language||!line.wordTimings.length||!words.length||words.some((w,i)=>!w.text.trim()||!Number.isFinite(w.startMs)||!Number.isFinite(w.endMs)||w.startMs<0||w.endMs<=w.startMs||w.endMs>context.window.lengthMs||i>0&&w.startMs<words[i-1].endMs)||words.at(-1)!.endMs<line.wordTimings.at(-1)!.endMs-500)throw Error('NARRATION_POLICY_CHANGED');
 verifySpokenText(context.transcript.recognizedText,context.transcript.recognizedText,context.transcript);
 assertPolicyRecognition(line.expectedAsrText,context.transcript.recognizedText);
}
export function verifyPolicyPostMixText(context:PostMixReviewContext,proof:NarrationPolicyProof){
 if(proof?.[authority]!==true||proof.contextSha256!==canonicalHash(context))throw Error('NARRATION_POLICY_CHANGED');
 return{status:'trusted_policy' as const,recognizedText:context.transcript.recognizedText,words:context.transcript.segments.flatMap(s=>s.words),narrationPolicyRef:proof.ref};
}
