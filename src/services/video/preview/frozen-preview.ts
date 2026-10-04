import {z} from 'zod';
import {ObjectRefSchema,UnderstandingSchema} from '@/contracts/video/domain';
import type {ProjectControl} from '@/contracts/video/project';
import {loadVerifiedFilmPackage} from '@/contracts/video/film-package';
import {PreparePreviewRequestSchema} from '@/contracts/video/commands';
import {canonicalHash} from '@/services/video/domain/hash';
import {readNarrationJson} from '@/services/video/audio/narration-package';
import {loadConfirmedPostMixReview} from '@/services/video/audio/postmix-review';
import {verifiedFilmHash} from '@/services/video/audio/postmix-asr';
import {compileVoicePlan} from './voice-plan';
import type {ProjectStore} from '@/services/video/storage/project-store';
import {StoreMissing} from '@/services/video/storage/atomic-store';
import {assertPreviewProductionFence} from './fence';
const hash=z.string().regex(/^[a-f0-9]{64}$/);
export const FrozenPreviewSchema=z.strictObject({sourceOperationId:z.uuid(),treatmentRef:ObjectRefSchema,filmSpecRef:ObjectRefSchema,reviewRef:ObjectRefSchema.optional(),film:z.strictObject({outputPath:z.string(),sha256:hash,durationMs:z.number().int(),technicalQa:z.literal('pass')})});
export type FrozenPreview=z.infer<typeof FrozenPreviewSchema>;
const sourceSchema=z.object({id:z.uuid(),projectId:z.uuid(),kind:z.literal('preview'),revisionId:z.uuid(),briefVersion:z.number().int(),consentEpoch:z.number().int(),understandingRef:ObjectRefSchema,status:z.literal('failed'),stage:z.literal('composition'),errorCode:z.enum(['POSTMIX_ASR_MISMATCH','PROVIDER_UNAVAILABLE','QA_FAILED','COMPOSITION_LOUDNESS_FAILED'])});
/** A new technical attempt keeps the exact creative revision. No unknown model
 * effect, changed brief or arbitrary scene may become a new creation here. */
export async function validateFrozenPreview(projects:ProjectStore,root:string,projectId:string,control:ProjectControl,untrusted:FrozenPreview){
 const input=FrozenPreviewSchema.parse(untrusted),prefix=`projects/${projectId}/`,source=sourceSchema.parse((await projects.store.readFresh(prefix+'operations/'+input.sourceOperationId)).value),revisionPrefix=prefix+`revisions/${source.revisionId}/`;
 if(source.id!==input.sourceOperationId||source.projectId!==projectId||source.consentEpoch!==control.consentEpoch||source.briefVersion!==control.briefVersion||canonicalHash(source.understandingRef)!==canonicalHash(control.understandingRef))throw Error('FROZEN_PREVIEW_CHANGED');
 const stage=(await projects.store.readFresh<{schemaVersion:number;briefVersion:number;filmSpecRef:FrozenPreview['filmSpecRef']}>(revisionPrefix+'film-package-v2-stage')).value;
 if(stage.schemaVersion!==2||stage.briefVersion!==control.briefVersion||canonicalHash(stage.filmSpecRef)!==canonicalHash(input.filmSpecRef))throw Error('FROZEN_PREVIEW_CHANGED');
 const spec=await readNarrationJson(projects.store,input.filmSpecRef,revisionPrefix+'film/'),frozen=await loadVerifiedFilmPackage(projects.store,spec,root);
 if(frozen.filmSpec.projectId!==projectId||frozen.filmSpec.revisionId!==source.revisionId||frozen.filmSpec.briefVersion!==control.briefVersion||canonicalHash(frozen.filmSpec.understandingRef)!==canonicalHash(control.understandingRef)||canonicalHash(frozen.treatment.planRef)!==canonicalHash(input.treatmentRef)||input.film.durationMs!==frozen.timeline.totalFrames*1000/frozen.timeline.fps)throw Error('FROZEN_PREVIEW_CHANGED');
 const understanding=UnderstandingSchema.parse(await readNarrationJson(projects.store,control.understandingRef,prefix+'understanding/')),treatment=await readNarrationJson(projects.store,input.treatmentRef,revisionPrefix+'treatment-plan/');
 if(frozen.timeline.narration.length){
  if(!input.reviewRef)throw Error('FROZEN_PREVIEW_REVIEW_REQUIRED');
  const proof=await loadConfirmedPostMixReview(projects.store,projectId,input.reviewRef);
  if(proof.challenge.sourceRevisionId!==source.revisionId||proof.challenge.filmSha256!==input.film.sha256||proof.challenge.planSha256!==canonicalHash(compileVoicePlan(treatment,understanding)))throw Error('FROZEN_PREVIEW_CHANGED');
 }else if(input.reviewRef||!['QA_FAILED','COMPOSITION_LOUDNESS_FAILED'].includes(source.errorCode))throw Error('FROZEN_PREVIEW_CHANGED');
 await verifiedFilmHash(root,input.film);
 const audio=(await projects.store.readFresh<{status:string;output?:unknown}>(prefix+`operations/${source.id}/effects/audio/${source.revisionId}`)).value;
 if(audio.status!=='completed')throw Error('FROZEN_PREVIEW_EFFECT_UNKNOWN');
 if(canonicalHash(audio.output)!==frozen.audioManifest.planRef.sha256)throw Error('FROZEN_PREVIEW_CHANGED');
 for(const shot of frozen.timeline.shots){
  const effect=(await projects.store.readFresh<{status:string;output?:unknown}>(prefix+`operations/${source.id}/effects/visual/${source.revisionId}/${canonicalHash({shotId:shot.id})}`)).value;
  if(effect.status!=='completed')throw Error('FROZEN_PREVIEW_EFFECT_UNKNOWN');
  const sourceModule=frozen.sourceManifest.modules.find(item=>item.id===shot.sourceModule);if(!sourceModule)throw Error('FROZEN_PREVIEW_CHANGED');
  const code=await readNarrationJson(projects.store,sourceModule.sourceRef,revisionPrefix) as {visualSourceRef:FrozenPreview['treatmentRef']};
  if(canonicalHash(effect.output)!==code.visualSourceRef.sha256)throw Error('FROZEN_PREVIEW_CHANGED');
 }
 return{source,input};
}
export async function readFrozenPreview(projects:ProjectStore,root:string,projectId:string,operationId:string,revisionId:string,consentEpoch:number){
 const prefix=`projects/${projectId}/`,op=(await projects.store.readFresh<{id:string;projectId:string;kind:string;commandId:string;revisionId:string;frozenPreviewSha256?:string}>(prefix+'operations/'+operationId)).value;
 let intent:{hash:string;frozenPreview?:FrozenPreview;frozenPreviewRequest?:unknown;revisionId:string;receipt:{operationId:string;commandId:string;projectId:string}};
 try{intent=(await projects.store.readFresh<typeof intent>(prefix+'commands/'+op.commandId)).value}catch(error){if(error instanceof StoreMissing)throw Error('FROZEN_PREVIEW_CHANGED',{cause:error});throw error}
 if(!intent.frozenPreview){if(op.frozenPreviewSha256!==undefined||intent.frozenPreviewRequest!==undefined)throw Error('FROZEN_PREVIEW_CHANGED');return}
 const input=FrozenPreviewSchema.parse(intent.frozenPreview),request=PreparePreviewRequestSchema.parse(intent.frozenPreviewRequest);
 if(op.id!==operationId||op.projectId!==projectId||op.kind!=='preview'||op.revisionId!==revisionId||intent.revisionId!==revisionId||request.clientCommandId!==op.commandId||intent.receipt.operationId!==operationId||intent.receipt.commandId!==op.commandId||intent.receipt.projectId!==projectId||op.frozenPreviewSha256!==canonicalHash(input)||intent.hash!==canonicalHash({kind:'prepare_preview',body:request,frozenPreview:input}))throw Error('FROZEN_PREVIEW_CHANGED');
 const control=(await projects.store.readFresh<ProjectControl>(prefix+'control')).value;assertPreviewProductionFence(control,projectId,operationId,consentEpoch);
 const result=await validateFrozenPreview(projects,root,projectId,control,input);if(result.source.revisionId!==revisionId)throw Error('FROZEN_PREVIEW_CHANGED');
 return input;
}
