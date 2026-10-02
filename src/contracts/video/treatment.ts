import{z}from'zod';
import{UnderstandingSchema,type Understanding}from'./domain';

const id=z.string().min(1).max(120),text=z.string().min(1).max(3000),frame=z.number().int().nonnegative();
const option=z.strictObject({id,concept:text,visualApproach:text,soundApproach:text,tradeoff:text});
const shot=z.strictObject({id,startFrame:frame,endFrame:frame,visualIntent:text,scriptLine:text,factIds:z.array(id)});
export const TreatmentPlanSchema=z.strictObject({schemaVersion:z.literal(1),briefVersion:z.number().int().nonnegative(),styleSlug:id,styleRulesHash:z.string().regex(/^[a-f0-9]{64}$/),durationSec:z.number().int().min(20).max(120),aspect:z.enum(['16:9','9:16']),fps:z.union([z.literal(24),z.literal(30),z.literal(60)]),summary:text,options:z.array(option).length(3),selectedOptionId:id,selectionReason:text,shots:z.array(shot).min(1).max(80),script:z.array(text).min(1).max(80)});
export type TreatmentPlan=z.infer<typeof TreatmentPlanSchema>;

export function guardTreatment(raw:unknown,understanding:Understanding,expectedStyleRulesHash:string):TreatmentPlan{
 const result=TreatmentPlanSchema.safeParse(raw),brief=UnderstandingSchema.safeParse(understanding);
 if(!result.success||!brief.success)throw Error('TREATMENT_INVALID');
 const plan=result.data,known=brief.data;
 if(!known.subject.trim()||known.unresolvedConflictIds.length||plan.briefVersion!==known.briefVersion||plan.styleSlug!==known.preferences.styleSlug||plan.styleRulesHash!==expectedStyleRulesHash||plan.durationSec!==known.preferences.durationSec||plan.aspect!==known.preferences.aspect)throw Error('TREATMENT_BASELINE_CHANGED');
 const selected=plan.options.find(option=>option.id===plan.selectedOptionId),ids=plan.options.map(option=>option.id),concepts=plan.options.map(option=>option.concept.normalize('NFKC').trim().toLocaleLowerCase());
 if(!selected||new Set(ids).size!==3||new Set(concepts).size!==3)throw Error('TREATMENT_OPTIONS_INVALID');
 const totalFrames=plan.durationSec*plan.fps,active=new Map(known.facts.filter(fact=>fact.status==='provided'||fact.status==='confirmed').map(fact=>[fact.id,fact]));
 let end=0;const shotIds=new Set<string>(),covered=new Set<string>();
 for(const item of plan.shots){
  if(item.startFrame!==end||item.endFrame<=item.startFrame||item.endFrame>totalFrames||shotIds.has(item.id))throw Error('TREATMENT_TIMELINE_INVALID');
  end=item.endFrame;shotIds.add(item.id);
  if(new Set(item.factIds).size!==item.factIds.length||item.factIds.some(id=>!active.has(id)))throw Error('TREATMENT_FACT_INVALID');
  item.factIds.forEach(id=>covered.add(id));
 }
 if(end!==totalFrames)throw Error('TREATMENT_TIMELINE_INVALID');
 if([...active.values()].some(fact=>(fact.critical||fact.mustInclude)&&!covered.has(fact.id)))throw Error('TREATMENT_FACT_MISSING');
 if(plan.script.length!==plan.shots.length||plan.script.some((line,index)=>line!==plan.shots[index].scriptLine))throw Error('TREATMENT_SCRIPT_INVALID');
 return plan;
}
