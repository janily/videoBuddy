import {it,expect} from 'vitest';
import {createServer} from 'node:http';
import {randomUUID} from 'node:crypto';
import {rm} from 'node:fs/promises';
import {seedApprovedProject} from './fixtures/approved-project';
import {buildPreviewPipeline} from '@/services/video/preview/pipeline';
import {requirementsContext} from '@/contracts/video/content-requirements';
import {canonicalHash} from '@/services/video/domain/hash';
import {updateJson} from '@/services/video/storage/atomic-store';
import {budgetKeys} from '@/services/video/config/environment';
import type {Understanding} from '@/contracts/video/domain';
import type {ProjectControl} from '@/contracts/video/project';

it('blocks new creative work when independent source audit rejects, after only two accounted native requests',async()=>{
 const f=await seedApprovedProject();let requests=0;const stages:string[]=[],bodies:string[]=[];
 const control=await f.projects.access('owner',f.projectId),u=(await f.projects.store.readFresh<Understanding>(control.understandingRef.key)).value,c=requirementsContext({understandingSha256:control.understandingRef.sha256,facts:u.facts});
 const proposal={schemaVersion:1,contextSha256:c.contextSha256,facts:c.facts.map(f=>({factId:f.id,segments:[{sourceText:f.text,kind:'literal',reason:'本地协议，完整原文。'}]}))},audit={schemaVersion:1,contextSha256:c.contextSha256,proposalSha256:canonicalHash(proposal),facts:proposal.facts.map(f=>({...f,segments:f.segments.map(s=>({...s,result:'reject',reason:'本地审核拒绝样本，不能进入创作。'}))}))};
 const server=createServer(async(req,res)=>{const chunks=[];for await(const part of req)chunks.push(part);bodies.push(Buffer.concat(chunks).toString());requests++;res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({id:'local-source-gate',object:'chat.completion',created:1,model:'unit-model',choices:[{index:0,message:{role:'assistant',content:JSON.stringify(requests===1?proposal:audit)},finish_reason:'stop'}],usage:{prompt_tokens:123,completion_tokens:67,total_tokens:190}}))});
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address();if(!address||typeof address==='string')throw Error('LOCAL_SERVER_FAILED');
 try{
 const operationId=randomUUID(),previewId=randomUUID(),commandId=randomUUID(),revisionId=randomUUID();
 await updateJson(f.projects.store,`projects/${f.projectId}/control`,(v:ProjectControl)=>({...v,phase:'preparing_preview' as const,activeProduction:operationId,currentApprovalId:undefined}));
 await f.projects.store.create(`projects/${f.projectId}/operations/${operationId}`,{id:operationId,projectId:f.projectId,commandId,kind:'preview',revisionId,previewId,briefVersion:control.briefVersion,consentEpoch:0,understandingRef:control.understandingRef,status:'running'});
 await f.projects.store.create(`projects/${f.projectId}/commands/${commandId}`,{revisionId});
 const env={...f.env,VIDEO_ENVIRONMENT:'local',VIDEO_DATA_DIR:f.root,VIDEO_APP_ORIGIN:'https://video.test',VIDEO_SESSION_SIGNING_KEY:'s'.repeat(64),VIDEO_GENERATION_ENABLED:'true',MODEL_PROVIDER:'openai-compatible',MODEL_BASE_URL:`http://127.0.0.1:${address.port}/v1`,MODEL_API_KEY:'unit-only',VIDEO_DIRECTOR_MODEL:'unit-model',VIDEO_CRITIC_MODEL:'unit-model',VIDEO_VISUAL_MODEL:'unit-model',VIDEO_AUDIO_MODEL:'unit-model',...Object.fromEntries(budgetKeys.map(key=>[key,'1000000']))};
 await expect(buildPreviewPipeline(f.projects,{projectId:f.projectId,operationId,revisionId,previewId,expectedConsentEpoch:0},{root:f.root,env},async stage=>{stages.push(stage)})).rejects.toThrow('CONTENT_REQUIREMENTS_UNAPPROVED');
 expect(stages).toEqual(['source']);expect(requests).toBe(2);expect(bodies[0]).toContain('活动在十月八日开始');expect(bodies[1]).toContain('独立审查员');
 await expect(f.projects.store.readFresh(`projects/${f.projectId}/revisions/${revisionId}/treatment-stage`)).rejects.toThrow();
 const budget=(await f.projects.store.readFresh<{accounting:Record<string,{state:string;inputTokens:number;outputTokens:number}>}>(`projects/${f.projectId}/budget`)).value;
 expect(Object.values(budget.accounting)).toHaveLength(2);for(const value of Object.values(budget.accounting))expect(value).toMatchObject({state:'settled',inputTokens:123,outputTokens:67});
 }finally{await new Promise<void>(resolve=>server.close(()=>resolve()));await rm(f.root,{recursive:true,force:true})}
});
