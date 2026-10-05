import {z} from 'zod';
import {ObjectRefSchema,UnderstandingSchema,type ObjectRef} from '@/contracts/video/domain';
import type {ProjectControl} from '@/contracts/video/project';
import {loadVerifiedFilmPackage} from '@/contracts/video/film-package';
import type {ProjectStore} from '../storage/project-store';
import {StoreMissing,type AtomicStore} from '../storage/atomic-store';
import {canonicalHash,canonicalJson} from '../domain/hash';
import {assertLiveProject} from '../commands/user-activity';
import {readNarrationJson} from './narration-package';
import {validateNarrationPolicySource} from './narration-policy';
import {verifyPostMixNarration,type PostMixFilm} from './postmix-asr';
import {asrConfiguration,AsrModelSchema} from './asr';
import {dockerConfiguration} from '../media/docker-executor';
import {readDockerInvocation} from '../media/docker-journal';
import {selectPostMixDownmix} from './postmix-extraction';
import {compileVoicePlan} from '../preview/voice-plan';
import {resolvePreviewPostMixReview} from '../preview/postmix-review';
import type {Environment} from '../config/environment';
const digest=z.string().regex(/^[a-f0-9]{64}$/);
const FilmSchema=z.strictObject({outputPath:z.string(),sha256:digest,durationMs:z.number().int(),technicalQa:z.literal('pass')});
const IdentitySchema=z.strictObject({projectId:z.uuid(),sourceOperationId:z.uuid(),sourceRevisionId:z.uuid(),ownerKeyHash:z.string().min(1),consentEpoch:z.number().int().nonnegative(),briefVersion:z.number().int(),filmSpecRef:ObjectRefSchema,film:FilmSchema});
const VerificationSchema=IdentitySchema.extend({schemaVersion:z.literal(1),kind:z.literal('completed_postmix_verification'),journalOperationId:z.uuid(),planRef:ObjectRefSchema,verifiedRef:ObjectRefSchema,downmix:z.literal('stereo_average').optional(),runtime:z.strictObject({mediaDigest:digest,asrDigest:digest,asrModel:AsrModelSchema}),resultSha256:digest,receipts:z.array(ObjectRefSchema).min(2).max(128)});
export type PostMixVerification=z.infer<typeof VerificationSchema>;
export type PostMixVerificationInput={sourceOperationId:string;filmSpecRef:ObjectRef;film:PostMixFilm};
/** A complete verification never falls back to pre-journal legacy artifacts.
 * Capture only receipts actually read by the cold verifier, with writes denied. */
export async function verifyCompletedPostMixJournal<T>(projects:ProjectStore,projectId:string,journalOperationId:string,verify:(store:AtomicStore,prefix:string)=>Promise<T>):Promise<{result:T;receipts:ObjectRef[]}>{
 if(![projectId,journalOperationId].every(id=>z.uuid().safeParse(id).success))throw Error('POSTMIX_VERIFICATION_CHANGED');
 const prefix=`projects/${projectId}/operations/${journalOperationId}/media-effects`,receipts=new Map<string,ObjectRef>(),store:AtomicStore={
  async readFresh<T>(key:string){
   let saved;try{saved=await projects.store.readFresh<T>(key)}catch(error){if(key.startsWith(prefix+'/')&&error instanceof StoreMissing)throw Error('POSTMIX_VERIFICATION_RECEIPT_REQUIRED');throw error}
   if(key.startsWith(prefix+'/')){
    const value=saved.value as {image?:string;state?:string};
    if(!value.image||!/^sha256:[a-f0-9]{64}$/.test(value.image))throw Error('POSTMIX_VERIFICATION_RECEIPT_REQUIRED');
    const receipt=await readDockerInvocation({store:projects.store,prefix},key.slice(prefix.length+1),value.image);
    if(receipt.state!=='completed'||canonicalHash(receipt)!==canonicalHash(saved.value))throw Error('POSTMIX_VERIFICATION_RECEIPT_REQUIRED');
    receipts.set(key,{key,sha256:canonicalHash(saved.value),bytes:Buffer.byteLength(canonicalJson(saved.value)),mime:'application/json'});
   }
   return saved;
  },async create(){throw Error('POSTMIX_VERIFICATION_READ_ONLY')},async cas(){throw Error('POSTMIX_VERIFICATION_READ_ONLY')},
 };
 const result=await verify(store,prefix);
 if(!receipts.size)throw Error('POSTMIX_VERIFICATION_RECEIPT_REQUIRED');
 return{result,receipts:[...receipts.values()].sort((a,b)=>a.key.localeCompare(b.key))};
}
async function sourceInputs(projects:ProjectStore,root:string,projectId:string,input:PostMixVerificationInput){
 const control=(await projects.store.readFresh<ProjectControl>(`projects/${projectId}/control`)).value;assertLiveProject(control);
 const source=z.object({id:z.uuid(),projectId:z.uuid(),kind:z.literal('preview'),status:z.literal('failed'),stage:z.literal('composition'),revisionId:z.uuid(),briefVersion:z.number().int(),consentEpoch:z.number().int(),understandingRef:ObjectRefSchema}).parse((await projects.store.readFresh(`projects/${projectId}/operations/${input.sourceOperationId}`)).value);
 if(source.id!==input.sourceOperationId||source.projectId!==projectId||source.consentEpoch!==control.consentEpoch||source.briefVersion!==control.briefVersion||canonicalHash(source.understandingRef)!==canonicalHash(control.understandingRef))throw Error('POSTMIX_VERIFICATION_CHANGED');
 const prefix=`projects/${projectId}/revisions/${source.revisionId}/`,stage=(await projects.store.readFresh<{schemaVersion:number;briefVersion:number;filmSpecRef:ObjectRef}>(prefix+'film-package-v2-stage')).value;
 if(stage.schemaVersion!==2||stage.briefVersion!==control.briefVersion||canonicalHash(stage.filmSpecRef)!==canonicalHash(input.filmSpecRef))throw Error('POSTMIX_VERIFICATION_CHANGED');
 const frozen=await loadVerifiedFilmPackage(projects.store,await readNarrationJson(projects.store,input.filmSpecRef,prefix+'film/'),root);
 if(frozen.filmSpec.projectId!==projectId||frozen.filmSpec.revisionId!==source.revisionId||frozen.filmSpec.briefVersion!==control.briefVersion||canonicalHash(frozen.filmSpec.understandingRef)!==canonicalHash(control.understandingRef)||input.film.durationMs!==frozen.timeline.totalFrames*1000/frozen.timeline.fps)throw Error('POSTMIX_VERIFICATION_CHANGED');
 const voice=(await projects.store.readFresh<{schemaVersion:number;planRef:ObjectRef;verifiedRef:ObjectRef}>(prefix+'voice-stage')).value;
 const {plan,verified}=await validateNarrationPolicySource(projects,root,projectId,source.revisionId,voice.planRef,voice.verifiedRef);
 const understanding=UnderstandingSchema.parse(await readNarrationJson(projects.store,control.understandingRef,`projects/${projectId}/understanding/`)),treatment=await readNarrationJson(projects.store,frozen.treatment.planRef,prefix+'treatment-plan/');
 if(canonicalHash(plan)!==canonicalHash(compileVoicePlan(treatment,understanding))||verified.lines.length!==frozen.timeline.narration.length||!verified.lines.length)throw Error('POSTMIX_VERIFICATION_CHANGED');
 for(const line of verified.lines){const archived=frozen.timeline.narration.find(l=>l.lineId===line.lineId);if(!archived||archived.audioRef.sha256!==line.voice.wav.sha256||archived.startSample!==line.startMs*48||archived.endSample!==archived.startSample+line.voice.wav.samples*2||archived.expectedAsrText!==line.expectedAsrText)throw Error('POSTMIX_VERIFICATION_CHANGED')}
 const identity=IdentitySchema.parse({projectId,sourceOperationId:source.id,sourceRevisionId:source.revisionId,ownerKeyHash:control.ownerKeyHash,consentEpoch:control.consentEpoch,briefVersion:control.briefVersion,filmSpecRef:input.filmSpecRef,film:input.film});
 return{identity,frozen,plan,verified,voice};
}
async function verifySource(projects:ProjectStore,root:string,input:PostMixVerificationInput,projectId:string,journalOperationId:string,env:Environment){
 const source=await sourceInputs(projects,root,projectId,input),media=dockerConfiguration(env,'postmix-verification'),asr=asrConfiguration(env);
 if(media.runtimeDigest!==source.frozen.filmSpec.runtimeDigest)throw Error('POSTMIX_VERIFICATION_CHANGED');
 const downmix=selectPostMixDownmix(source.frozen.filmSpec.qualityPolicyVersion,source.frozen.filmAudioTrack?.wav.channels??1);
 const checked=await verifyCompletedPostMixJournal(projects,projectId,journalOperationId,(store,prefix)=>verifyPostMixNarration(root,input.film,source.plan,source.verified,env,undefined,{mustExist:true,...(downmix?{downmix}:{}),journal:{store,prefix},resolveReview:context=>resolvePreviewPostMixReview(projects,root,projectId,source.identity.sourceRevisionId,context,{mustExist:true,verified:source.verified})}));
 if(checked.result.status!=='pass'||checked.result.lines.length!==source.plan.lines.length||checked.receipts.length!==source.plan.lines.length*2)throw Error('POSTMIX_VERIFICATION_CHANGED');
 // Fence again after slow filesystem/media reads, before making an immutable
 // reference. A concurrent cancellation must invalidate the entire group.
 const latest=await sourceInputs(projects,root,projectId,input);if(canonicalHash(latest.identity)!==canonicalHash(source.identity))throw Error('POSTMIX_VERIFICATION_CHANGED');
 return VerificationSchema.parse({...source.identity,schemaVersion:1,kind:'completed_postmix_verification',journalOperationId,planRef:source.voice.planRef,verifiedRef:source.voice.verifiedRef,...(downmix?{downmix}:{}),runtime:{mediaDigest:media.runtimeDigest,asrDigest:asr.runtimeDigest,asrModel:asr.model},resultSha256:canonicalHash(checked.result),receipts:checked.receipts});
}
export async function persistPostMixVerification(projects:ProjectStore,root:string,owner:string,projectId:string,input:PostMixVerificationInput,journalOperationId:string,env:Environment=process.env){
 await projects.access(owner,projectId);
 const record=await verifySource(projects,root,input,projectId,journalOperationId,env);
 await projects.access(owner,projectId);
 return projects.index.immutable(`projects/${projectId}/postmix-verifications`,record);
}
export async function loadPostMixVerification(projects:ProjectStore,root:string,projectId:string,ref:ObjectRef,input:PostMixVerificationInput){
 const record=VerificationSchema.parse(await readNarrationJson(projects.store,ref,`projects/${projectId}/postmix-verifications/`));
 if(record.projectId!==projectId||record.sourceOperationId!==input.sourceOperationId||canonicalHash(record.filmSpecRef)!==canonicalHash(input.filmSpecRef)||canonicalHash(record.film)!==canonicalHash(input.film))throw Error('POSTMIX_VERIFICATION_CHANGED');
 const env:Environment={VIDEO_MEDIA_IMAGE_REF:'sha256:'+record.runtime.mediaDigest,VIDEO_MEDIA_RUNTIME_DIGEST:record.runtime.mediaDigest,VIDEO_MEDIA_TIMEOUT_SECONDS:'600',VIDEO_ASR_IMAGE_REF:'sha256:'+record.runtime.asrDigest,VIDEO_ASR_RUNTIME_DIGEST:record.runtime.asrDigest,VIDEO_ASR_MODEL:record.runtime.asrModel};
 const actual=await verifySource(projects,root,input,projectId,record.journalOperationId,env);
 if(canonicalHash(actual)!==canonicalHash(record))throw Error('POSTMIX_VERIFICATION_CHANGED');return record;
}
