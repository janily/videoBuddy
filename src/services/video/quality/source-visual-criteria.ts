import type {loadVerifiedFilmPackage} from '@/contracts/video/film-package';
/** Only the verified immutable graph supplies the criterion policy. Neither
 * the reviewer nor a public request may select which source words to check. */
export function frozenVisualCriteria(frozen:Awaited<ReturnType<typeof loadVerifiedFilmPackage>>){
 if(frozen.facts.schemaVersion===1)return undefined;
 if(!frozen.contentRequirements)throw Error('CRITIC_BASELINE_CHANGED');
 return{factsRef:frozen.filmSpec.factsRef,contentRequirementsRef:frozen.facts.contentRequirementsRef,facts:frozen.facts.facts,requirements:frozen.contentRequirements.requirements};
}
