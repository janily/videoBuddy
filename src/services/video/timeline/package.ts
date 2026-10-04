import type {FilmTimeline} from '@/contracts/video/film';
import type {TreatmentPlan} from '@/contracts/video/treatment';
import type {TimingDraft} from '@/services/video/preview/timing-draft';
import {canonicalHash} from '@/services/video/domain/hash';

export const legacyFilmPackagePolicyVersion='v5.1-package-1';
export const filmPackagePolicyVersion='v5.1-package-2-caption-coordinates';
export const captionStyleId='narration-caption';
export function captionStyleForProfile(profile:'full'|'preview'|'probe',output?:{width:number;height:number},policyVersion:string=filmPackagePolicyVersion){
 if(policyVersion===filmPackagePolicyVersion){
  if(!output||![[1920,1080],[1080,1920]].some(([width,height])=>output.width===width&&output.height===height))throw Error('CAPTION_LAYOUT_REQUIRED');
  return {fontSize:68,marginV:72,outline:3,primary:'#FFFFFF',outlineColor:'#000000',playResX:output.width,playResY:output.height};
 }
 if(policyVersion!==legacyFilmPackagePolicyVersion)throw Error('FILM_POLICY_UNSUPPORTED');
 const sizes=profile==='probe'?{fontSize:42,marginV:12,outline:2}:profile==='preview'?{fontSize:54,marginV:48,outline:3}:{fontSize:68,marginV:72,outline:3};
 return {...sizes,primary:'#FFFFFF',outlineColor:'#000000'};
}
export function frozenCaptions(timing:TimingDraft,treatment:TreatmentPlan):FilmTimeline['captions']{
 return timing.captions.map(cue=>{
  const index=Number(cue.lineId.replace(/^line_/,''))-1,shot=treatment.shots[index];
  if(!shot||cue.lineId!==`line_${index+1}`)throw Error('FILM_CAPTION_CHANGED');
  return {id:`caption-${canonicalHash(cue).slice(0,24)}`,lineId:cue.lineId,text:cue.text,startFrame:cue.startFrame,endFrame:cue.endFrame,stableReadableStartFrame:cue.startFrame,styleRef:captionStyleId,factIds:shot.factIds};
 });
}
export function narrationSilence(lines:FilmTimeline['narration'],totalSamples:number):FilmTimeline['intentionalSilenceRanges']{
 const ranges:FilmTimeline['intentionalSilenceRanges']=[];let end=0;
 for(const line of [...lines].sort((a,b)=>a.startSample-b.startSample)){
  if(line.startSample>end)ranges.push({startSample:end,endSample:line.startSample,buses:['voice']});
  end=line.endSample;
 }
 if(end<totalSamples)ranges.push({startSample:end,endSample:totalSamples,buses:['voice']});
 return ranges;
}
