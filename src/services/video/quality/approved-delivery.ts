import type {QualityCheck} from './publish-gate';
import {mandatoryDeliveryRules,type DeliveryPolicy} from './delivery';
interface CompositionEvidence{movie:{technicalQa:{sha256:string};loudness:{status:string;filmSha256:string}};postMix:{status:string;filmSha256:string;reason?:string}}
interface ContentEvidence{report:{filmSha256:string;result:'pass'|'fail'|'not_checked';scope:'two_round_provided_frames_and_verified_transcripts';deliveryEligible:false};ref:string}
interface VisualEvidence{filmSha256:string;result:'pass'|'fail'|'not_checked';criticalFactsResult:'pass'|'fail'|'not_checked'}
/** Consumes verified producer evidence. Does not replace independent semantic,
 * listening, font and license checks with technical decode or sampled-frame pass. */
export function compileApprovedDeliveryChecks(policy:DeliveryPolicy,composition:CompositionEvidence,visual:VisualEvidence,technicalRef:string,visualRef:string,content?:ContentEvidence):QualityCheck[]{
 const sha=composition.movie.technicalQa.sha256;
 if(!/^[a-f0-9]{64}$/.test(sha)||composition.movie.loudness.filmSha256!==sha||composition.postMix.filmSha256!==sha||visual.filmSha256!==sha)throw Error('RENDER_OUTPUT_CHANGED');
 if(content&&(content.report.filmSha256!==sha||content.report.scope!=='two_round_provided_frames_and_verified_transcripts'||content.report.deliveryEligible!==false||!content.ref))throw Error('RENDER_OUTPUT_CHANGED');
 const checks:QualityCheck[]=mandatoryDeliveryRules.map(ruleId=>({ruleId,result:'not_checked',severity:'blocking',evidenceRefs:[],reason:'Required independent evidence has not been supplied.'}));
 checks.push({ruleId:'content_coverage',result:content?.report.result||'not_checked',severity:'blocking',evidenceRefs:content?[content.ref]:[],...(content?{}:{reason:'Independent whole-content evidence has not been supplied.'})});
 function set(ruleId:string,result:QualityCheck['result'],ref:string,reason?:string){const check=checks.find(c=>c.ruleId===ruleId)!;Object.assign(check,{result,evidenceRefs:[ref],...(reason?{reason}:{})});if(!reason)delete check.reason}
 for(const rule of ['decode','media_metadata','duration','file_hash','source_integrity','resource_ready'])set(rule,'pass',technicalRef);
 set('critical_facts',visual.criticalFactsResult,visualRef);
 set('visual_review',visual.result==='fail'?'fail':'not_checked',visualRef,'Two-round sampled frames do not establish continuous-motion quality.');
 if(!policy.captions)set('subtitle_sync','not_applicable',technicalRef,'No captions in the frozen film.');
 if(policy.audioIntent==='silent'&&composition.postMix.status==='not_applicable'&&composition.postMix.reason==='intentional_silence'&&composition.movie.loudness.status==='not_applicable'){
  checks.push({ruleId:'decoded_silence',result:'pass',severity:'blocking',evidenceRefs:[technicalRef]});
  for(const rule of ['listening_review','loudness','true_peak'])set(rule,'not_applicable',technicalRef,'The actual full movie was decoded and measured as intentional silence.');
 }else for(const rule of ['loudness','true_peak'])set(rule,composition.movie.loudness.status==='pass'?'pass':'fail',technicalRef);
 return checks;
}
