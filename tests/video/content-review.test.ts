import {it,expect} from 'vitest';
import {canonicalHash} from '@/services/video/domain/hash';
import {contentReviewContext,guardContentReview,type ContentReviewContext,type ContentReview} from '@/contracts/video/content-review';
const facts=[{id:'flow',text:'先播种，再浇水，最后发芽。',sourceRefs:[{type:'user_message' as const,id:'source'}],status:'confirmed' as const,mustInclude:true,critical:true},{id:'name',text:'名称为青禾。',sourceRefs:[{type:'user_message' as const,id:'source'}],status:'provided' as const,mustInclude:true,critical:true}];
const input={filmSha256:'a'.repeat(64),filmSpecSha256:'b'.repeat(64),factsManifestSha256:canonicalHash({schemaVersion:1,facts}),fps:24 as const,totalFrames:480,facts,requirements:[{factId:'flow',representation:'semantic' as const,exactText:[]},{factId:'name',representation:'literal' as const,exactText:['青禾']}],frames:[{id:'frame-24',frame:24,sha256:'c'.repeat(64),bytes:100},{id:'frame-360',frame:360,sha256:'d'.repeat(64),bytes:100}],transcripts:[{id:'line',startSample:0,endSample:48000,audioSha256:'e'.repeat(64),text:'先播种，再浇水。',verification:'pass' as const}]};
function review(c:ContentReviewContext):ContentReview{return{schemaVersion:1,contextSha256:c.contextSha256,scope:'provided_frames_and_verified_transcripts',observations:[{frameId:'frame-24',description:'种子放入土壤，浇水。',visibleText:['青禾']},{frameId:'frame-360',description:'种子发芽。',visibleText:[]}],facts:[{factId:'flow',result:'pass',coverage:'complete',reason:'先种植浇水再发芽的顺序由实际帧及转写表达。',evidence:[{kind:'frame_scene',frameId:'frame-24',quote:'种子放入土壤，浇水。'},{kind:'frame_scene',frameId:'frame-360',quote:'种子发芽。'},{kind:'transcript',transcriptId:'line',quote:'先播种，再浇水。'}],literalChecks:[]},{factId:'name',result:'pass',coverage:'complete',reason:'画面显示来源中的名称。',evidence:[{kind:'frame_text',frameId:'frame-24',quote:'青禾'}],literalChecks:[{sourceExcerpt:'青禾',result:'pass',evidence:[{kind:'frame_text',frameId:'frame-24',quote:'青禾'}],reason:'逐字匹配'}]}],conflicts:[]}}
it('supports flow meaning using bound scene observations without requiring a paragraph overlay',()=>{const c=contentReviewContext(input);expect(c).toMatchObject({facts:[{id:'flow'},{id:'name'}],filmSha256:'a'.repeat(64)});expect(guardContentReview(review(c),c).facts[0].result).toBe('pass')});
it('rejects a dropped frozen fact or changed transcript/clock digest',()=>{
 expect(()=>contentReviewContext({...input,facts:facts.slice(1)})).toThrow('CONTENT_INPUT_CHANGED');
 const c=contentReviewContext(input),changed={...c,transcripts:[{...c.transcripts[0],text:'明天就会发芽。'}]};expect(()=>guardContentReview(review(c),changed)).toThrow('CONTENT_INPUT_CHANGED');
 expect(()=>contentReviewContext({...input,transcripts:[{...input.transcripts[0],endSample:10000000}]})).toThrow('CONTENT_INPUT_INVALID');
});
it('rejects invented observations, absent fact judgments and planned words used as actual transcript quotes',()=>{
 const c=contentReviewContext(input),v=review(c);v.observations.pop();expect(()=>guardContentReview(v,c)).toThrow('CONTENT_EVIDENCE_INVALID');
 const missing=review(c);missing.facts.pop();expect(()=>guardContentReview(missing,c)).toThrow('CONTENT_EVIDENCE_INVALID');
 const planned=review(c);planned.facts[0].evidence=[{kind:'transcript',transcriptId:'line',quote:'最后发芽。'}];expect(()=>guardContentReview(planned,c)).toThrow('CONTENT_EVIDENCE_INVALID');
});
it('preserves exact name spelling and blocks a pass over incomplete or conflicting evidence',()=>{
 const c=contentReviewContext(input),wrong=review(c);wrong.observations[0].visibleText=['清和'];wrong.facts[1].evidence=[{kind:'frame_text',frameId:'frame-24',quote:'清和'}];wrong.facts[1].literalChecks[0].evidence=[{kind:'frame_text',frameId:'frame-24',quote:'清和'}];expect(()=>guardContentReview(wrong,c)).toThrow('CONTENT_LITERAL_EVIDENCE_INVALID');
 const partial=review(c);partial.facts[0].coverage='partial';expect(()=>guardContentReview(partial,c)).toThrow('CONTENT_EVIDENCE_INVALID');
 const conflict=review(c);conflict.conflicts=[{factId:'name',description:'实际名称和来源冲突。',frameIds:['frame-24'],transcriptIds:[]}];expect(()=>guardContentReview(conflict,c)).toThrow('CONTENT_EVIDENCE_INVALID');
 expect(()=>guardContentReview({...review(c),listening:{result:'pass'}},c)).toThrow('CONTENT_REVIEW_INVALID');
});
it('does not let punctuation or one correct quote hide contradictory literal quotations',()=>{
 const c=contentReviewContext(input),punctuation=review(c);punctuation.facts[1].literalChecks[0].sourceExcerpt='。';expect(()=>guardContentReview(punctuation,c)).toThrow('CONTENT_LITERAL_EVIDENCE_INVALID');
 const mixed=review(c);mixed.observations[1].visibleText=['清和'];mixed.facts[1].literalChecks[0].evidence.push({kind:'frame_text',frameId:'frame-360',quote:'清和'});expect(()=>guardContentReview(mixed,c)).toThrow('CONTENT_LITERAL_EVIDENCE_INVALID');
});
it('preserves the original ASR whitespace and rejects fact IDs that no review can reference',()=>{
 const raw={...input,transcripts:[{...input.transcripts[0],text:' 先播种，再浇水。 '}]};expect(contentReviewContext(raw).transcripts[0].text).toBe(' 先播种，再浇水。 ');
 const {requirements,...plain}=input;void requirements;const longFacts=[{...facts[0],id:'x'.repeat(121)}];expect(()=>contentReviewContext({...plain,facts:longFacts,factsManifestSha256:canonicalHash({schemaVersion:1,facts:longFacts})})).toThrow('CONTENT_INPUT_INVALID');
});
it('cannot omit the trusted required literal check to pass a wrong proper name',()=>{
 const c=contentReviewContext(input),wrong=review(c);wrong.observations[0].visibleText=['清和'];wrong.facts[1].evidence=[{kind:'frame_text',frameId:'frame-24',quote:'清和'}];wrong.facts[1].literalChecks=[];
 expect(()=>guardContentReview(wrong,c)).toThrow('CONTENT_LITERAL_EVIDENCE_INVALID');
});
it('defaults unclassified legacy facts to literal checks and freezes every trusted requirement',()=>{
 const {requirements,...unclassified}=input;void requirements;const c=contentReviewContext(unclassified);
 expect(c.requirements).toEqual([{factId:'flow',representation:'literal',exactText:['先播种，再浇水，最后发芽。']},{factId:'name',representation:'literal',exactText:['名称为青禾。']}]);
 expect(()=>guardContentReview(review(c),c)).toThrow('CONTENT_LITERAL_EVIDENCE_INVALID');
 expect(()=>contentReviewContext({...input,requirements:input.requirements.slice(1)})).toThrow('CONTENT_INPUT_INVALID');
 expect(()=>contentReviewContext({...input,requirements:[input.requirements[0],{factId:'name',representation:'literal',exactText:['清和']}]})).toThrow('CONTENT_INPUT_INVALID');
 const known=contentReviewContext(input),changed={...known,requirements:[{factId:'flow',representation:'semantic' as const,exactText:[]},{factId:'name',representation:'semantic' as const,exactText:[]}]};expect(()=>guardContentReview(review(known),changed)).toThrow('CONTENT_INPUT_CHANGED');
});

it('keeps raw ASR quotations while accepting a frozen whole-line Mandarin pronunciation proof',()=>{
 const literal='闭上眼睛，它轻轻入睡。',fact={...facts[0],id:'voice',text:'旁白原文为“'+literal+'”'},raw={...input,facts:[fact],factsManifestSha256:canonicalHash({schemaVersion:1,facts:[fact]}),requirements:[{factId:'voice',representation:'literal' as const,exactText:[literal]}],transcripts:[{...input.transcripts[0],text:'闭上眼睛 他轻轻入睡',spokenTextEvidence:{policy:'mandarin_pronunciation_v1' as const,expectedText:literal,sourceRef:{key:'projects/p/revisions/r/narration-source/source',sha256:'f'.repeat(64),bytes:100,mime:'application/json'}}}]};
 const c=contentReviewContext(raw),quote={kind:'transcript' as const,transcriptId:'line',quote:'闭上眼睛 他轻轻入睡'},v:ContentReview={schemaVersion:1,contextSha256:c.contextSha256,scope:'provided_frames_and_verified_transcripts',observations:c.frames.map(f=>({frameId:f.id,description:'小猫安静入睡。',visibleText:[]})),facts:[{factId:'voice',result:'pass',coverage:'complete',reason:'最终音轨已按冻结全文发音验证，原始ASR选字保留。',evidence:[quote],literalChecks:[{sourceExcerpt:literal,result:'pass',evidence:[quote],reason:'完整发音核验证据'}]}],conflicts:[]};
 expect(c.transcripts[0].text).toBe(raw.transcripts[0].text);expect(guardContentReview(v,c).facts[0].result).toBe('pass');
 const {spokenTextEvidence,...legacy}=raw.transcripts[0];void spokenTextEvidence;const old=contentReviewContext({...raw,transcripts:[legacy]});expect(()=>guardContentReview({...v,contextSha256:old.contextSha256},old)).toThrow('CONTENT_LITERAL_EVIDENCE_INVALID');
 expect(()=>contentReviewContext({...raw,transcripts:[{...raw.transcripts[0],text:'闭上眼睛 他轻轻离开'}]})).toThrow();
 expect(()=>contentReviewContext({...raw,transcripts:[{...raw.transcripts[0],text:'1.8',spokenTextEvidence:{...raw.transcripts[0].spokenTextEvidence,expectedText:'18'}}]})).toThrow('CONTENT_INPUT_INVALID');
 expect(()=>contentReviewContext({...raw,transcripts:[{...raw.transcripts[0],text:'\u77f3\u53ea\u5c0f\u732b',spokenTextEvidence:{...raw.transcripts[0].spokenTextEvidence,expectedText:'\u5341\u53ea\u5c0f\u732b'}}]})).toThrow('CONTENT_INPUT_INVALID');
 const fragment=structuredClone(v);fragment.facts[0].literalChecks[0].evidence[0]={...quote,quote:'他轻轻入睡'};expect(()=>guardContentReview(fragment,c)).toThrow('CONTENT_LITERAL_EVIDENCE_INVALID');
});
