import {it,expect} from 'vitest';
import {requirementsContext,guardRequirementsProposal,guardRequirementsAudit,approvedRequirements} from '@/contracts/video/content-requirements';
import {canonicalHash} from '@/services/video/domain/hash';
import {contentReviewContext} from '@/contracts/video/content-review';
const fact={id:'flow',text:'先播种，再浇水，最后发芽。',sourceRefs:[{type:'user_message' as const,id:'source'}],status:'confirmed' as const,mustInclude:true,critical:true};
const context=()=>requirementsContext({understandingSha256:'a'.repeat(64),facts:[fact]});
const proposal=()=>({schemaVersion:1 as const,contextSha256:context().contextSha256,facts:[{factId:fact.id,segments:[{sourceText:fact.text,kind:'semantic' as const,reason:'按顺序完整表达三个动作。'}]}]});
const audit=()=>({schemaVersion:1 as const,contextSha256:context().contextSha256,proposalSha256:canonicalHash(proposal()),facts:[{factId:fact.id,segments:[{sourceText:fact.text,kind:'semantic' as const,result:'accept' as const,reason:'只有流程，没有专名或数字。'}]}]});
it('freezes canonically unique literal names that the downstream content contract can consume',()=>{
 const c=requirementsContext({understandingSha256:'a'.repeat(64),facts:[{...fact,text:'Café 和 Cafe\u0301'}]}),p={schemaVersion:1 as const,contextSha256:c.contextSha256,facts:[{factId:'flow',segments:[{sourceText:'Café',kind:'literal' as const,reason:'名称。'},{sourceText:' 和 ',kind:'semantic' as const,reason:'普通关系。'},{sourceText:'Cafe\u0301',kind:'literal' as const,reason:'相同规范化名称的原始写法。'}]}]},a={schemaVersion:1 as const,contextSha256:c.contextSha256,proposalSha256:canonicalHash(p),facts:p.facts.map(f=>({...f,segments:f.segments.map(s=>({...s,result:'accept' as const}))}))};
 const requirements=approvedRequirements(c,p,a);expect(requirements).toEqual([{factId:'flow',representation:'semantic',exactText:['Café']}]);
 expect(()=>contentReviewContext({filmSha256:'b'.repeat(64),filmSpecSha256:'c'.repeat(64),factsManifestSha256:canonicalHash({schemaVersion:1,facts:c.facts}),facts:c.facts,requirements,fps:24,totalFrames:480,frames:[{id:'frame-0',frame:0,sha256:'d'.repeat(64),bytes:100}],transcripts:[]})).not.toThrow();
});
it('rejects audited punctuation-only literal criteria before immutable production freezing',()=>{
 const c=requirementsContext({understandingSha256:'a'.repeat(64),facts:[{...fact,text:'。'}]}),p={schemaVersion:1 as const,contextSha256:c.contextSha256,facts:[{factId:'flow',segments:[{sourceText:'。',kind:'literal' as const,reason:'不可作为有效字面条件的标点。'}]}]},a={schemaVersion:1 as const,contextSha256:c.contextSha256,proposalSha256:canonicalHash(p),facts:p.facts.map(f=>({...f,segments:f.segments.map(s=>({...s,result:'accept' as const}))}))};
 expect(()=>approvedRequirements(c,p,a)).toThrow('CONTENT_REQUIREMENTS_INVALID');
});
it('freezes semantic conditions only after exact full-source proposal and independent audit agree',()=>{
 const c=context(),p=guardRequirementsProposal(proposal(),c),a=guardRequirementsAudit(audit(),c,p);
 expect(approvedRequirements(c,p,a)).toEqual([{factId:'flow',representation:'semantic',exactText:[]}]);
 expect(()=>approvedRequirements(c,p,{...a,facts:a.facts.map(f=>({...f,segments:f.segments.map(s=>({...s,result:'not_checked' as const}))}))})).toThrow('CONTENT_REQUIREMENTS_UNAPPROVED');
});
it('rejects deleted source clauses, altered baselines, missing facts and borrowed audit',()=>{
 const c=context(),p=proposal();
 expect(()=>guardRequirementsProposal({...p,facts:[]},c)).toThrow('CONTENT_REQUIREMENTS_INVALID');
 expect(()=>guardRequirementsProposal({...p,facts:[{...p.facts[0],segments:[{...p.facts[0].segments[0],sourceText:'先播种。'}]}]},c)).toThrow('CONTENT_REQUIREMENTS_INVALID');
 expect(()=>guardRequirementsProposal({...p,contextSha256:'b'.repeat(64)},c)).toThrow('CONTENT_REQUIREMENTS_BASELINE_CHANGED');
 expect(()=>guardRequirementsAudit({...audit(),proposalSha256:'c'.repeat(64)},c,p)).toThrow('CONTENT_REQUIREMENTS_BASELINE_CHANGED');
 expect(()=>guardRequirementsAudit({...audit(),facts:[]},c,p)).toThrow('CONTENT_REQUIREMENTS_INVALID');
});
it('keeps source names literal when the auditor rejects an unsafe semantic classification',()=>{
 const c=requirementsContext({understandingSha256:'a'.repeat(64),facts:[{...fact,text:'青禾学校举办植树活动。'}]}),p={schemaVersion:1 as const,contextSha256:c.contextSha256,facts:[{factId:'flow',segments:[{sourceText:c.facts[0].text,kind:'semantic' as const,reason:'错误的全部语义分类。'}]}]},a={schemaVersion:1 as const,contextSha256:c.contextSha256,proposalSha256:canonicalHash(p),facts:[{factId:'flow',segments:[{sourceText:c.facts[0].text,kind:'semantic' as const,result:'reject' as const,reason:'遗漏需要字面保留的名称青禾学校。'}]}]};
 expect(()=>approvedRequirements(c,p,a)).toThrow('CONTENT_REQUIREMENTS_UNAPPROVED');
});
it.each(['活动日期是10月8日。','价格是￥39.90。','标题必须为“观察成长”。','标题必须为‘观察成长’。','The event is on October 8th.'])('enforces literal numeric/date/quoted floors before model approval: %s',text=>{
 const c=requirementsContext({understandingSha256:'a'.repeat(64),facts:[{...fact,text}]}),p={schemaVersion:1 as const,contextSha256:c.contextSha256,facts:[{factId:'flow',segments:[{sourceText:text,kind:'semantic' as const,reason:'错误的全部语义分类。'}]}]};
 expect(()=>guardRequirementsProposal(p,c)).toThrow('CONTENT_REQUIREMENTS_LITERAL_MISSING');
 const checked=guardRequirementsProposal({...p,facts:[{factId:'flow',segments:[{sourceText:text,kind:'literal' as const,reason:'完整字面来源。'}]}]},c),a={schemaVersion:1 as const,contextSha256:c.contextSha256,proposalSha256:canonicalHash(checked),facts:[{factId:'flow',segments:[{sourceText:text,kind:'literal' as const,result:'accept' as const,reason:'完整字面来源。'}]}]};
 expect(approvedRequirements(c,checked,a)[0].exactText).toEqual([text]);
});
it('preserves every quoted narration sentence as a separately verifiable literal condition',()=>{
 const lines=['睡前，小猫把小枕头摆好。','闭上眼睛，它轻轻入睡。','屋里静悄悄的，夜色好温柔。','晚安，小猫。'];
 const c=requirementsContext({understandingSha256:'a'.repeat(64),facts:[{...fact,text:'旁白与字幕原文：“'+lines.join('')+'”'}]});
 const segments=[{sourceText:'旁白与字幕原文：“',kind:'semantic' as const,reason:'引文前缀与定界符。'},...lines.map(sourceText=>({sourceText,kind:'literal' as const,reason:'完整原文句子。'})),{sourceText:'”',kind:'semantic' as const,reason:'引文定界符。'}];
 const p={schemaVersion:1 as const,contextSha256:c.contextSha256,facts:[{factId:'flow',segments}]};
 const a={schemaVersion:1 as const,contextSha256:c.contextSha256,proposalSha256:canonicalHash(p),facts:p.facts.map(f=>({...f,segments:f.segments.map(s=>({...s,result:'accept' as const}))}))};
 expect(approvedRequirements(c,p,a)[0].exactText).toEqual(lines);
 const gap={...p,facts:[{factId:'flow',segments:segments.map((s,i)=>i===2?{...s,kind:'semantic' as const}:s)}]};
 expect(()=>guardRequirementsProposal(gap,c)).toThrow('CONTENT_REQUIREMENTS_LITERAL_MISSING');
});
it.each(['“青禾学校”','“10月8日”','“￥39.90”'])('does not split a quoted name, date or number into separately satisfiable fragments: %s',text=>{
 const c=requirementsContext({understandingSha256:'a'.repeat(64),facts:[{...fact,text}]}),body=text.slice(1,-1);
 const p={schemaVersion:1 as const,contextSha256:c.contextSha256,facts:[{factId:'flow',segments:[{sourceText:'“',kind:'semantic' as const,reason:'定界符。'},{sourceText:body.slice(0,1),kind:'literal' as const,reason:'错误拆分。'},{sourceText:body.slice(1),kind:'literal' as const,reason:'错误拆分。'},{sourceText:'”',kind:'semantic' as const,reason:'定界符。'}]}]};
 expect(()=>guardRequirementsProposal(p,c)).toThrow('CONTENT_REQUIREMENTS_LITERAL_MISSING');
});
