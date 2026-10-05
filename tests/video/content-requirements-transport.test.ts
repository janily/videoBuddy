import {it,expect} from 'vitest';
import {createServer} from 'node:http';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {FileStore} from '@/services/video/storage/file-store';
import {reserveModelBudget} from '@/services/video/budget/model-budget';
import {withAccountedModel} from '@/services/video/budget/model-call';
import {requirementsContext,approvedRequirements} from '@/contracts/video/content-requirements';
import {runRequirementsProposal,runRequirementsAudit} from '@/mastra/video/content-requirements';
import {canonicalHash} from '@/services/video/domain/hash';
it('uses separate native Mastra requests for complete source classification and independent audit with exact usage',async()=>{
 const context=requirementsContext({understandingSha256:'a'.repeat(64),facts:[{id:'flow',text:'先播种，再浇水。',sourceRefs:[{type:'user_message',id:'source-message'}],status:'confirmed',mustInclude:true,critical:true}]}),proposal={schemaVersion:1 as const,contextSha256:context.contextSha256,facts:[{factId:'flow',segments:[{sourceText:context.facts[0].text,kind:'semantic' as const,reason:'按顺序表达流程。'}]}]},audit={schemaVersion:1 as const,contextSha256:context.contextSha256,proposalSha256:canonicalHash(proposal),facts:proposal.facts.map(f=>({...f,segments:f.segments.map(s=>({...s,result:'accept' as const,reason:'来源仅要求此流程，不含名称或日期。'}))}))};
 // Local provider fixture verifies native transport/accounting, not model truth.
 const bodies:string[]=[],server=createServer(async(req,res)=>{const chunks=[];for await(const part of req)chunks.push(part);bodies.push(Buffer.concat(chunks).toString());res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({id:'unit-requirements',object:'chat.completion',created:1,model:'unit-model',choices:[{index:0,message:{role:'assistant',content:JSON.stringify(bodies.length===1?proposal:audit)},finish_reason:'stop'}],usage:{prompt_tokens:123,completion_tokens:67,total_tokens:190}}))});
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address();if(!address||typeof address==='string')throw Error('LOCAL_SERVER_FAILED');const root=await mkdtemp(join(tmpdir(),'vb-req-http-'));
 try{const store=new FileStore(root),env={MODEL_PROVIDER:'openai-compatible',MODEL_BASE_URL:`http://127.0.0.1:${address.port}/v1`,MODEL_API_KEY:'unit-only',VIDEO_DIRECTOR_MODEL:'unit-model',VIDEO_CRITIC_MODEL:'unit-model'},limits={projectCalls:2,projectInputTokens:10000,projectOutputTokens:10000,dailyCalls:2};
  const r1=await reserveModelBudget(store,'project','requirements-proposal',{inputTokens:1000,outputTokens:1000},limits),p=await withAccountedModel(store,r1.reservation,()=>runRequirementsProposal(context,1000,env));
  const r2=await reserveModelBudget(store,'project','requirements-audit',{inputTokens:1000,outputTokens:1000},limits),a=await withAccountedModel(store,r2.reservation,()=>runRequirementsAudit(context,p,1000,env));
  expect(bodies).toHaveLength(2);expect(bodies[0]).toContain(context.facts[0].text);expect(bodies[1]).toContain(canonicalHash(proposal));expect(bodies[1]).toContain('独立审查员');expect(approvedRequirements(context,p,a)).toEqual([{factId:'flow',representation:'semantic',exactText:[]}]);
  const budget=(await store.readFresh<{accounting:Record<string,unknown>}>('projects/project/budget')).value;for(const r of [r1,r2])expect(budget.accounting[r.reservation.id]).toMatchObject({state:'settled',inputTokens:123,outputTokens:67});
 }finally{await new Promise<void>(resolve=>server.close(()=>resolve()));await rm(root,{recursive:true,force:true})}
});
it('fences a started source-analysis attempt before HTTP and preserves unknown usage',async()=>{
 const context=requirementsContext({understandingSha256:'a'.repeat(64),facts:[]}),root=await mkdtemp(join(tmpdir(),'vb-req-fence-')),saved=globalThis.fetch;let requests=0,checks=0;globalThis.fetch=async()=>{requests++;throw Error('HTTP_MUST_NOT_RUN')};
 try{const store=new FileStore(root),r=await reserveModelBudget(store,'project','requirements-fence',{inputTokens:1000,outputTokens:1000},{projectCalls:1,projectInputTokens:10000,projectOutputTokens:10000,dailyCalls:1});
  await expect(withAccountedModel(store,r.reservation,()=>runRequirementsProposal(context,1000,{MODEL_PROVIDER:'openai-compatible',MODEL_BASE_URL:'http://127.0.0.1:1/v1',MODEL_API_KEY:'unit-only',VIDEO_DIRECTOR_MODEL:'unit-model'},async()=>{if(++checks===2)throw Error('PREVIEW_STALE')}))).rejects.toThrow('PREVIEW_STALE');
  expect(requests).toBe(0);expect((await store.readFresh<{accounting:Record<string,unknown>}>('projects/project/budget')).value.accounting[r.reservation.id]).toMatchObject({state:'unknown'});
 }finally{globalThis.fetch=saved;await rm(root,{recursive:true,force:true})}
});
