import type {ProjectStore} from '../storage/project-store';
import {createPostMixReviewChallenge,findConfirmedPostMixReview,type PostMixReviewContext} from '../audio/postmix-review';
/** Keep a real mismatch reviewable without granting a waiver or changing ASR.
 * Cache-only verification must not create new challenges. */
export async function resolvePreviewPostMixReview(projects:ProjectStore,root:string,projectId:string,revisionId:string,context:PostMixReviewContext,options:{mustExist?:boolean}={}){
 const proof=await findConfirmedPostMixReview(projects.store,projectId,context);
 if(!proof&&!options.mustExist)await createPostMixReviewChallenge(projects,root,projectId,revisionId,context);
 return proof;
}
