import {it,expect} from 'vitest';
import {visualReviewContext,guardVisualReview,type VisualReview} from '@/contracts/video/visual-review';
import {canonicalHash,canonicalJson} from '@/services/video/domain/hash';
import {wholeFilmVisualPlan,aggregateWholeVisualReviews} from '@/services/video/quality/whole-visual-plan';
import {compileApprovedDeliveryChecks} from '@/services/video/quality/approved-delivery';
import {mandatoryDeliveryRules} from '@/services/video/quality/delivery';
const facts=[{id:'event',text:'青禾学校在十月八日举办植树活动。',sourceRefs:[{type:'user_message' as const,id:'message'}],status:'confirmed' as const,mustInclude:true,critical:true},{id:'flow',text:'先播种，再浇水，最后发芽。',sourceRefs:[{type:'user_message' as const,id:'message'}],status:'confirmed' as const,mustInclude:true,critical:true}];
const ref=(key:string,value:unknown)=>({key,sha256:canonicalHash(value),bytes:Buffer.byteLength(canonicalJson(value)),mime:'application/json'});
const proofRef=ref('projects/p/revisions/r/content-requirements-proof/test',{test:true}),manifest={schemaVersion:2,facts,contentRequirementsRef:proofRef};
const sourceCriteria={factsRef:ref('projects/p/revisions/r/facts/test',manifest),contentRequirementsRef:proofRef,facts,requirements:[{factId:'event',representation:'semantic' as const,exactText:['青禾学校','十月八日']},{factId:'flow',representation:'semantic' as const,exactText:[]}]};
const baseline={filmSha256:'a'.repeat(64),filmSpecSha256:'b'.repeat(64),styleSlug:'crayon-book',styleRulesHash:'c'.repeat(64),facts:facts.map(({id,text})=>({id,text})),sourceCriteria};
function context(){return visualReviewContext({...baseline,round:1,frames:[{id:'frame-0',frame:0,sha256:'d'.repeat(64),bytes:100},{id:'frame-24',frame:24,sha256:'e'.repeat(64),bytes:100}]})}
function review():Extract<VisualReview,{schemaVersion:2}>{const c=context();return{schemaVersion:2,sourceCriteriaSha256:canonicalHash(sourceCriteria),filmSha256:c.filmSha256,filmSpecSha256:c.filmSpecSha256,frameSetSha256:c.frameSetSha256,styleSlug:c.styleSlug,styleRulesHash:c.styleRulesHash,round:1,scope:'sampled_frames',observations:[{frameId:'frame-0',visibleText:['青禾学校'],issues:[]},{frameId:'frame-24',visibleText:['十月八日'],issues:[]}],facts:[{factId:'event',result:'pass',frameIds:['frame-0','frame-24'],reason:'两个必需字面条件分别出现在两帧，不声称检查完整叙事。',literalChecks:[{sourceExcerpt:'青禾学校',result:'pass',frameIds:['frame-0'],reason:'所给帧完整名称。'},{sourceExcerpt:'十月八日',result:'pass',frameIds:['frame-24'],reason:'所给帧完整日期。'}]},{factId:'flow',result:'not_checked',frameIds:[],reason:'普通叙事由完整内容QA检查。',literalChecks:[]}],style:{result:'pass',frameIds:['frame-0'],reason:'本地协议风格观察。'},readability:{result:'pass',frameIds:['frame-24'],reason:'本地协议字面观察。'}}}
it('checks all frozen literal anchors across provided frames without requiring a prose paragraph on screen',()=>{
 expect(()=>guardVisualReview(review(),context())).not.toThrow();
});
it('rejects a changed or incomplete frozen source criterion graph',()=>{
 expect(()=>visualReviewContext({...baseline,sourceCriteria:{...sourceCriteria,requirements:sourceCriteria.requirements.slice(1)},round:1,frames:[{id:'frame-0',frame:0,sha256:'d'.repeat(64),bytes:100}]})).toThrow('CRITIC_BASELINE_CHANGED');
 expect(()=>visualReviewContext({...baseline,sourceCriteria:{...sourceCriteria,factsRef:{...sourceCriteria.factsRef,sha256:'f'.repeat(64)}},round:1,frames:[{id:'frame-0',frame:0,sha256:'d'.repeat(64),bytes:100}]})).toThrow('CRITIC_BASELINE_CHANGED');
 expect(()=>visualReviewContext({...baseline,sourceCriteria:{...sourceCriteria,factsRef:{...sourceCriteria.factsRef,bytes:sourceCriteria.factsRef.bytes+1}},round:1,frames:[{id:'frame-0',frame:0,sha256:'d'.repeat(64),bytes:100}]})).toThrow('CRITIC_BASELINE_CHANGED');
});
it('never accepts omitted anchors, homophone names, wrong dates or a visual pass for pure semantics',()=>{
 const c=context(),r=review();
 expect(()=>guardVisualReview({...r,sourceCriteriaSha256:'0'.repeat(64)},c)).toThrow('CRITIC_BASELINE_CHANGED');
 for(const text of ['清和学校','十月九日'])expect(()=>guardVisualReview({...r,observations:r.observations.map(o=>({...o,visibleText:[text]}))},c)).toThrow('CRITIC_FACT_EVIDENCE_INVALID');
 expect(()=>guardVisualReview({...r,facts:r.facts.map(f=>f.factId==='event'?{...f,literalChecks:f.literalChecks.slice(1)}:f)},c)).toThrow('CRITIC_FACT_EVIDENCE_INVALID');
 expect(()=>guardVisualReview({...r,facts:r.facts.map(f=>f.factId==='flow'?{...f,result:'pass',frameIds:['frame-0']}:f)},c)).toThrow('CRITIC_FACT_EVIDENCE_INVALID');
});
it('requires literal evidence in each independent round and full content evidence before critical facts pass',()=>{
 const plan=wholeFilmVisualPlan({fps:24,totalFrames:480,shots:[{id:'whole',startFrame:0,endFrame:480}],captions:[]});
 const entries=plan.rounds.flatMap(round=>round.batches.map(batch=>{
  const c=visualReviewContext({...baseline,round:round.round,frames:batch.frames.map(frame=>({id:'frame-'+frame,frame,sha256:'d'.repeat(64),bytes:100}))}),r=review(),selected=batch.index<2?batch.index:-1;
  const literalChecks=sourceCriteria.requirements[0].exactText.map((sourceExcerpt,i)=>({sourceExcerpt,result:i===selected?'pass' as const:'not_checked' as const,frameIds:i===selected?[c.frames[0].id]:[],reason:'本地批次观察。'}));
  return{context:c,review:{...r,round:round.round,frameSetSha256:c.frameSetSha256,observations:c.frames.map(frame=>({frameId:frame.id,visibleText:selected>=0?[sourceCriteria.requirements[0].exactText[selected]]:[],issues:[]})),facts:[{...r.facts[0],result:'not_checked' as const,frameIds:[],literalChecks},r.facts[1]],style:{...r.style,frameIds:[c.frames[0].id]},readability:{...r.readability,frameIds:[c.frames[0].id]}}};
 }));
 const visual=aggregateWholeVisualReviews(plan,baseline,entries);
 expect(visual).toMatchObject({literalFactsResult:'pass',criticalFactsResult:'not_checked',deliveryEligible:false});
 const policy={schemaVersion:1 as const,audioIntent:'silent' as const,captions:false,requiredRules:[...mandatoryDeliveryRules]},composition={movie:{technicalQa:{sha256:baseline.filmSha256},loudness:{status:'not_applicable',filmSha256:baseline.filmSha256}},postMix:{status:'not_applicable',reason:'intentional_silence',filmSha256:baseline.filmSha256}},content={report:{filmSha256:baseline.filmSha256,filmSpecSha256:baseline.filmSpecSha256,factsManifestSha256:sourceCriteria.factsRef.sha256,result:'pass' as const,scope:'two_round_provided_frames_and_verified_transcripts' as const,deliveryEligible:false as const},ref:'complete-content-proof'};
 expect(compileApprovedDeliveryChecks(policy,composition,visual,'technical','visual').find(c=>c.ruleId==='critical_facts')?.result).toBe('not_checked');
 expect(compileApprovedDeliveryChecks(policy,composition,visual,'technical','visual',content).find(c=>c.ruleId==='critical_facts')).toMatchObject({result:'pass',evidenceRefs:['visual','complete-content-proof']});
 expect(()=>compileApprovedDeliveryChecks(policy,composition,visual,'technical','visual',{...content,report:{...content.report,factsManifestSha256:'0'.repeat(64)}})).toThrow('RENDER_OUTPUT_CHANGED');
 const changed=entries.map(entry=>entry.context.round===2?{...entry,review:{...entry.review,facts:entry.review.facts.map(f=>f.factId==='event'?{...f,literalChecks:f.literalChecks.map(check=>({...check,result:'not_checked' as const,frameIds:[]}))}:f)}}:entry);
 expect(aggregateWholeVisualReviews(plan,baseline,changed)).toMatchObject({literalFactsResult:'not_checked',criticalFactsResult:'not_checked'});
});
it('rejects literal numeric anchors inside larger dates, negative values or changed decimal tokens',()=>{
 for(const [anchor,wrong,correct] of [['8日','活动在18日举行。','活动在8日举行。'],['十月八日','活动在二十月八日举行。','活动在十月八日举行。'],['18元','价格1.8元。','价格18元。'],['8元','价格-8元。','价格8元。'],['8','价格8.5元。','价格8元。'],['8元','价格1．8元。','价格8元。'],['8','数值为8%。','数值为8。'],['8','数值为8％。','数值为8。'],['8元','价格1/8元。','价格8元。'],['8元','价格1e8元。','价格8元。'],['8','Value 1e8','Grade 8'],['8','Value 8e3','Grade: 8'],['8','Value 8%','There are 8 eggs'],['8','Value 1e8','There are 8 examples']]){
  const fullFacts=[{...facts[0],text:`活动为${anchor}，完成。`}],requirements=[{factId:'event',representation:'semantic' as const,exactText:[anchor]}],manifest={schemaVersion:2,facts:fullFacts,contentRequirementsRef:proofRef},criteria={...sourceCriteria,facts:fullFacts,requirements,factsRef:ref('projects/p/revisions/r/facts/test',manifest)},c=visualReviewContext({...baseline,facts:fullFacts.map(({id,text})=>({id,text})),sourceCriteria:criteria,round:1,frames:context().frames});
  const r={...review(),sourceCriteriaSha256:canonicalHash(criteria),facts:[{...review().facts[0],frameIds:['frame-0'],literalChecks:[{sourceExcerpt:anchor,result:'pass' as const,frameIds:['frame-0'],reason:'字面观察。'}]}],observations:review().observations.map(o=>({...o,visibleText:[wrong]}))};
  expect(()=>guardVisualReview(r,c)).toThrow('CRITIC_FACT_EVIDENCE_INVALID');
  expect(()=>guardVisualReview({...r,observations:r.observations.map(o=>({...o,visibleText:[correct]}))},c)).not.toThrow();
 }
});
