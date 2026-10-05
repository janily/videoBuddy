import {createHash} from 'node:crypto';
export type PostMixDownmix='stereo_average';
export function postMixExtractionVersion(downmix?:PostMixDownmix){
 if(downmix!==undefined&&downmix!=='stereo_average')throw Error('POSTMIX_JOB_INVALID');
 return downmix==='stereo_average'?'postmix-v2-stereo-average':'postmix-v1';
}
export function postMixExtractionKey(filmSha256:string,lineId:string,language:string,window:{startMs:number;lengthMs:number;mediaRuntimeDigest:string;downmix?:PostMixDownmix}){
 return createHash('sha256').update(JSON.stringify([filmSha256,lineId,language,window.startMs,window.lengthMs,window.mediaRuntimeDigest,postMixExtractionVersion(window.downmix)])).digest('hex');
}
/** Missing metadata on an existing successful stage means the original v1
 * protocol. Only new stages may adopt the policy4 stereo-average default. */
export function selectPostMixDownmix(policyVersion:string,channels:number,existing?:{postMixDownmix?:PostMixDownmix}):PostMixDownmix|undefined{
 const candidate=policyVersion==='v5.1-package-4-clear-book-captions'&&channels===2?'stereo_average':undefined;
 if(existing){if(existing.postMixDownmix!==undefined&&existing.postMixDownmix!==candidate)throw Error('POSTMIX_POLICY_CHANGED');return existing.postMixDownmix}
 return candidate;
}
