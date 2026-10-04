import type {ProjectStore} from '../storage/project-store';
import {StoreMissing} from '../storage/atomic-store';
import {canonicalHash} from '../domain/hash';
import type {PostMixFilm} from '../audio/postmix-asr';
import {readFrozenPreview} from './frozen-preview';
/** A technical continuation reads the original producer's completed receipts.
 * Resolve ownership from the persisted, validated command; never copy receipts
 * into another operation or accept a caller-provided journal prefix. */
export async function compositionMediaJournal(projects:ProjectStore,root:string,projectId:string,revisionId:string,operationId:string,consentEpoch:number,requestedFilm?:PostMixFilm){
 let marked=false;
 try{marked=(await projects.store.readFresh<{frozenPreviewSha256?:string}>(`projects/${projectId}/operations/${operationId}`)).value.frozenPreviewSha256!==undefined}catch(error){if(!(error instanceof StoreMissing))throw error}
 if(!marked){if(requestedFilm)throw Error('FROZEN_PREVIEW_CHANGED');return{store:projects.store,prefix:`projects/${projectId}/operations/${operationId}/media-effects`}}
 let frozen;try{frozen=await readFrozenPreview(projects,root,projectId,operationId,revisionId,consentEpoch)}catch(error){throw Error('FROZEN_PREVIEW_CHANGED',{cause:error})}
 if(!frozen||requestedFilm&&canonicalHash(requestedFilm)!==canonicalHash(frozen.film))throw Error('FROZEN_PREVIEW_CHANGED');
 return{store:projects.store,prefix:`projects/${projectId}/operations/${frozen.sourceOperationId}/media-effects`};
}
