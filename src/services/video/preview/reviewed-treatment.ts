import {z} from 'zod';
import {PreparePreviewRequestSchema} from '@/contracts/video/commands';
import {ObjectRefSchema,type ObjectRef,type Understanding} from '@/contracts/video/domain';
import type {ProjectControl} from '@/contracts/video/project';
import {guardTreatment} from '@/contracts/video/treatment';
import type {ProjectStore} from '@/services/video/storage/project-store';
import {createOrRead,StoreMissing} from '@/services/video/storage/atomic-store';
import {canonicalHash,canonicalJson} from '@/services/video/domain/hash';
import {loadConfirmedSpeechReview,assertSpeechReviewLine} from '@/services/video/audio/spoken-review';
import {getStyle} from '@/services/video/styles/registry';
import {compileVoicePlan} from './voice-plan';
import {assertPreviewProductionFence} from './fence';

export const ReviewedTreatmentSchema=z.strictObject({sourceOperationId:z.uuid(),treatmentRef:ObjectRefSchema,reviewRef:ObjectRefSchema});
export type ReviewedTreatment=z.infer<typeof ReviewedTreatmentSchema>;
const sourceOperation=z.object({id:z.uuid(),projectId:z.uuid(),kind:z.literal('preview'),revisionId:z.uuid(),briefVersion:z.number().int().nonnegative(),consentEpoch:z.number().int().nonnegative(),understandingRef:ObjectRefSchema,status:z.literal('failed'),errorCode:z.literal('ASR_MISMATCH'),stage:z.literal('voice')});
const reuseSchema=z.strictObject({schemaVersion:z.literal(1),kind:z.literal('reviewed_treatment_reuse'),projectId:z.uuid(),operationId:z.uuid(),revisionId:z.uuid(),consentEpoch:z.number().int().nonnegative(),understandingRef:ObjectRefSchema,source:ReviewedTreatmentSchema});

async function readRef(projects:ProjectStore,ref:ObjectRef,prefix:string){
 if(ref.mime!=='application/json'||!ref.key.startsWith(prefix))throw Error('TREATMENT_REUSE_CHANGED');
 const value=(await projects.store.readFresh(ref.key)).value;
 if(canonicalHash(value)!==ref.sha256||Buffer.byteLength(canonicalJson(value))!==ref.bytes)throw Error('TREATMENT_REUSE_CHANGED');
 return value;
}
/** Reuses an already completed model effect after an explicitly confirmed
 * pronunciation discrepancy. No callback, guessed script or unknown effect
 * can provide the plan. This is not approval for formal film production. */
export async function validateReviewedTreatment(projects:ProjectStore,projectId:string,control:ProjectControl,raw:ReviewedTreatment){
 const input=ReviewedTreatmentSchema.parse(raw),prefix=`projects/${projectId}/`;
 const parsed=sourceOperation.safeParse((await projects.store.readFresh(prefix+'operations/'+input.sourceOperationId)).value);
 if(!parsed.success)throw Error('TREATMENT_REUSE_CHANGED');
 const source=parsed.data;
 if(source.id!==input.sourceOperationId||source.projectId!==projectId||source.consentEpoch!==control.consentEpoch||source.briefVersion!==control.briefVersion||canonicalHash(source.understandingRef)!==canonicalHash(control.understandingRef))throw Error('TREATMENT_REUSE_CHANGED');
 const understanding=await readRef(projects,control.understandingRef,prefix+'understanding/') as Understanding;
 if(!understanding.preferences.styleSlug)throw Error('TREATMENT_REUSE_CHANGED');
 const plan=guardTreatment(await readRef(projects,input.treatmentRef,prefix+`revisions/${source.revisionId}/treatment-plan/`),understanding,getStyle(understanding.preferences.styleSlug).rulesHash);
 const effect=(await projects.store.readFresh<{status:string;output?:unknown}>(prefix+`operations/${source.id}/effects/treatment/${source.revisionId}`)).value;
 if(effect.status!=='completed')throw Error('TREATMENT_REUSE_UNKNOWN');
 if(canonicalHash(effect.output)!==canonicalHash(plan))throw Error('TREATMENT_REUSE_CHANGED');
 const proof=await loadConfirmedSpeechReview(projects.store,projectId,input.reviewRef),voicePlan=compileVoicePlan(plan,understanding),line=voicePlan.lines.find(item=>item.lineId===proof.challenge.lineId);
 if(!line||proof.challenge.sourceRevisionId!==source.revisionId)throw Error('TREATMENT_REUSE_CHANGED');
 assertSpeechReviewLine(proof,line,proof.challenge.voiceRuntimeDigest,canonicalHash(voicePlan));
 return{plan,source:input};
}
export async function persistReviewedTreatment(projects:ProjectStore,projectId:string,operationId:string,revisionId:string,expectedConsentEpoch:number,source:ReviewedTreatment){
 const prefix=`projects/${projectId}/`,control=(await projects.store.readFresh<ProjectControl>(prefix+'control')).value;
 assertPreviewProductionFence(control,projectId,operationId,expectedConsentEpoch);
 await validateReviewedTreatment(projects,projectId,control,source);
 const record=reuseSchema.parse({schemaVersion:1,kind:'reviewed_treatment_reuse',projectId,operationId,revisionId,consentEpoch:expectedConsentEpoch,understandingRef:control.understandingRef,source});
 const stored=await createOrRead(projects.store,prefix+`operations/${operationId}/reviewed-treatment-reuse`,record);
 if(canonicalHash(stored)!==canonicalHash(record))throw Error('TREATMENT_REUSE_CHANGED');
}
export async function readReviewedTreatment(projects:ProjectStore,projectId:string,operationId:string,revisionId:string,expectedConsentEpoch:number){
 const prefix=`projects/${projectId}/`;let raw:unknown;
 try{raw=(await projects.store.readFresh(prefix+`operations/${operationId}/reviewed-treatment-reuse`)).value}catch(error){if(!(error instanceof StoreMissing))throw error}
 let operation:{id:string;projectId:string;commandId:string;kind:string;revisionId:string;reviewedTreatmentSha256?:string};
 try{operation=(await projects.store.readFresh<typeof operation>(prefix+`operations/${operationId}`)).value}catch(error){if(error instanceof StoreMissing&&!raw)return;throw error}
 if(operation.id!==operationId||operation.projectId!==projectId||operation.kind!=='preview'||operation.revisionId!==revisionId||!z.uuid().safeParse(operation.commandId).success)throw Error('TREATMENT_REUSE_CHANGED');
 let intent:{hash:string;revisionId:string;reviewedTreatment?:ReviewedTreatment;reviewedTreatmentRequest?:unknown;receipt:{operationId:string;commandId:string;projectId:string}};
 try{intent=(await projects.store.readFresh<typeof intent>(prefix+'commands/'+operation.commandId)).value}catch(error){if(error instanceof StoreMissing){if(operation.reviewedTreatmentSha256!==undefined||raw)throw Error('TREATMENT_REUSE_CHANGED');return}throw error}
 if(!intent.reviewedTreatment){if(raw||operation.reviewedTreatmentSha256!==undefined||intent.reviewedTreatmentRequest!==undefined)throw Error('TREATMENT_REUSE_CHANGED');return}
 const source=ReviewedTreatmentSchema.parse(intent.reviewedTreatment),request=PreparePreviewRequestSchema.parse(intent.reviewedTreatmentRequest);
 if(operation.reviewedTreatmentSha256!==canonicalHash(source))throw Error('TREATMENT_REUSE_CHANGED');
 if(request.clientCommandId!==operation.commandId||intent.revisionId!==revisionId||intent.receipt.operationId!==operationId||intent.receipt.commandId!==operation.commandId||intent.receipt.projectId!==projectId||intent.hash!==canonicalHash({kind:'prepare_preview',body:request,reviewedTreatment:source}))throw Error('TREATMENT_REUSE_CHANGED');
 // The accepted command freezes the reuse intent before any dispatch. If the
 // host died after control activation, cold recovery restores this record
 // rather than falling through to a second model creation.
 if(!raw){await persistReviewedTreatment(projects,projectId,operationId,revisionId,expectedConsentEpoch,source);raw=(await projects.store.readFresh(prefix+`operations/${operationId}/reviewed-treatment-reuse`)).value}
 const parsed=reuseSchema.safeParse(raw);if(!parsed.success)throw Error('TREATMENT_REUSE_CHANGED');const record=parsed.data;
 const control=(await projects.store.readFresh<ProjectControl>(prefix+'control')).value;
 assertPreviewProductionFence(control,projectId,operationId,expectedConsentEpoch);
 if(record.projectId!==projectId||record.operationId!==operationId||record.revisionId!==revisionId||record.consentEpoch!==expectedConsentEpoch||canonicalHash(record.understandingRef)!==canonicalHash(control.understandingRef)||canonicalHash(record.source)!==canonicalHash(source))throw Error('TREATMENT_REUSE_CHANGED');
 const result=await validateReviewedTreatment(projects,projectId,control,source);
 const latest=(await projects.store.readFresh<ProjectControl>(prefix+'control')).value;
 assertPreviewProductionFence(latest,projectId,operationId,expectedConsentEpoch,{briefVersion:control.briefVersion,understandingRef:control.understandingRef});
 return result;
}
