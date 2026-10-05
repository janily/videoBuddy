import {rm} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {it,expect} from 'vitest';
import {seedApprovedProject} from './fixtures/approved-project';
import {updateJson} from '@/services/video/storage/atomic-store';
import type {ProjectControl} from '@/contracts/video/project';
import type {Understanding} from '@/contracts/video/domain';
import {canonicalHash} from '@/services/video/domain/hash';
import {budgetKeys} from '@/services/video/config/environment';
import {prepareContentRequirementsStage,loadContentRequirements} from '@/services/video/preview/content-requirements-stage';
import type {RequirementsContext,RequirementsProposal} from '@/contracts/video/content-requirements';
async function seed(){const f=await seedApprovedProject(),operationId=randomUUID();await updateJson(f.projects.store,`projects/${f.projectId}/control`,(c:ProjectControl)=>({...c,phase:'preparing_preview' as const,activeProduction:operationId,currentApprovalId:undefined}));await f.projects.store.create(`projects/${f.projectId}/operations/${operationId}`,{id:operationId,projectId:f.projectId,kind:'preview',revisionId:f.bundle.revisionId,previewId:f.bundle.previewId,briefVersion:f.bundle.briefVersion,consentEpoch:0,understandingRef:(await f.projects.access('owner',f.projectId)).understandingRef,status:'running'});return{...f,operationId}}
function proposal(c:RequirementsContext){return{schemaVersion:1 as const,contextSha256:c.contextSha256,facts:c.facts.map(f=>({factId:f.id,segments:[{sourceText:f.text,kind:'literal' as const,reason:'完整来源，保守逐字保留。'}]}))}}
function audit(c:RequirementsContext,p:RequirementsProposal){return{schemaVersion:1 as const,contextSha256:c.contextSha256,proposalSha256:canonicalHash(p),facts:p.facts.map(f=>({factId:f.factId,segments:f.segments.map(s=>({...s,result:'accept' as const}))}))}}
it('freezes full-source classification and independent audit once; cold source verification writes nothing',async()=>{
 const f=await seed();try{let calls=0;const options={env:f.env,propose:async(c:RequirementsContext)=>{calls++;return proposal(c)},audit:async(c:RequirementsContext,p:RequirementsProposal)=>{calls++;return audit(c,p)}};
 const first=await prepareContentRequirementsStage(f.projects,f.projectId,f.bundle.revisionId,f.operationId,0,options);expect(calls).toBe(2);const c=await f.projects.access('owner',f.projectId);
 const knowledge=(await f.projects.store.readFresh<{facts:RequirementsContext['facts']}>(c.understandingRef.key)).value;
 const create=f.projects.store.create.bind(f.projects.store),cas=f.projects.store.cas.bind(f.projects.store);f.projects.store.create=async()=>{throw Error('COLD_WRITE')};f.projects.store.cas=async()=>{throw Error('COLD_WRITE')};
 expect(await loadContentRequirements(f.projects.store,f.projectId,f.bundle.revisionId,{understandingSha256:c.understandingRef.sha256,facts:knowledge.facts})).toEqual(first);
 expect(await prepareContentRequirementsStage(f.projects,f.projectId,f.bundle.revisionId,f.operationId,0,{...options,mustExist:true})).toEqual(first);expect(calls).toBe(2);f.projects.store.create=create;f.projects.store.cas=cas;
 }finally{await rm(f.root,{recursive:true,force:true})}
});
it('never repeats an unknown audit and refuses a late freeze after source cancellation',async()=>{
 const f=await seed();try{let calls=0;const invoke=()=>prepareContentRequirementsStage(f.projects,f.projectId,f.bundle.revisionId,f.operationId,0,{env:f.env,propose:async c=>proposal(c),audit:async()=>{calls++;throw Error('TIMEOUT')}});
 await expect(invoke()).rejects.toThrow('TIMEOUT');await expect(invoke()).rejects.toThrow('EFFECT_UNKNOWN');expect(calls).toBe(1);
 await updateJson(f.projects.store,`projects/${f.projectId}/control`,(c:ProjectControl)=>({...c,consentEpoch:1,activeProduction:null}));await expect(invoke()).rejects.toThrow('PREVIEW_STALE');
 await expect(f.projects.store.readFresh(`projects/${f.projectId}/revisions/${f.bundle.revisionId}/content-requirements-v1-stage`)).rejects.toThrow();
 }finally{await rm(f.root,{recursive:true,force:true})}
});
it('rejects cancellation inside classification before requesting audit or committing source proof',async()=>{
 const f=await seed();try{let audits=0;
 await expect(prepareContentRequirementsStage(f.projects,f.projectId,f.bundle.revisionId,f.operationId,0,{env:f.env,propose:async c=>{await updateJson(f.projects.store,`projects/${f.projectId}/control`,(v:ProjectControl)=>({...v,consentEpoch:1,activeProduction:null}));return proposal(c)},audit:async(c,p)=>{audits++;return audit(c,p)}})).rejects.toThrow('PREVIEW_STALE');expect(audits).toBe(0);
 await expect(f.projects.store.readFresh(`projects/${f.projectId}/revisions/${f.bundle.revisionId}/content-requirements-v1-stage`)).rejects.toThrow();
 }finally{await rm(f.root,{recursive:true,force:true})}
});
it('fails configuration before creating an unknown effect and can proceed once the missing dependency is supplied',async()=>{
 const f=await seed();try{
 await expect(prepareContentRequirementsStage(f.projects,f.projectId,f.bundle.revisionId,f.operationId,0,{env:{VIDEO_GENERATION_ENABLED:'false'}})).rejects.toThrow('GENERATION_DISABLED');
 expect(await f.projects.store.listKeys!(`projects/${f.projectId}/operations/${f.operationId}/effects/content-requirements`,1)).toEqual([]);
 await expect(prepareContentRequirementsStage(f.projects,f.projectId,f.bundle.revisionId,f.operationId,0,{propose:async c=>proposal(c),audit:async(c,p)=>audit(c,p)})).resolves.toMatchObject({productionApproval:false});
 }finally{await rm(f.root,{recursive:true,force:true})}
});
it('checks the complete audit payload before budget or effect admission on every replay',async()=>{
 const f=await seed();try{const c=await f.projects.access('owner',f.projectId),u=(await f.projects.store.readFresh<Understanding>(c.understandingRef.key)).value;
 const updated={...u,facts:Array.from({length:65},(_,i)=>({...u.facts[0],id:'fact-'+i,text:'播种后浇水。'}))},ref=await f.projects.index.immutable(`projects/${f.projectId}/understanding/${c.briefVersion}`,updated);
 await updateJson(f.projects.store,`projects/${f.projectId}/control`,(v:ProjectControl)=>({...v,understandingRef:ref}));await updateJson(f.projects.store,`projects/${f.projectId}/operations/${f.operationId}`,(v:object)=>({...v,understandingRef:ref}));
 let proposals=0;const invoke=()=>prepareContentRequirementsStage(f.projects,f.projectId,f.bundle.revisionId,f.operationId,0,{env:{VIDEO_ENVIRONMENT:'local',VIDEO_APP_ORIGIN:'https://video.test',VIDEO_SESSION_SIGNING_KEY:'s'.repeat(64),VIDEO_DATA_DIR:f.root,VIDEO_GENERATION_ENABLED:'true',MODEL_PROVIDER:'openai-compatible',MODEL_BASE_URL:'http://127.0.0.1:1/v1',MODEL_API_KEY:'unit-only',VIDEO_DIRECTOR_MODEL:'unit-model',VIDEO_CRITIC_MODEL:'unit-model',...Object.fromEntries(budgetKeys.map(key=>[key,'1000000']))},limits:{projectCalls:2,projectInputTokens:1000000,projectOutputTokens:1000000,dailyCalls:2},propose:async context=>{proposals++;return{schemaVersion:1,contextSha256:context.contextSha256,facts:context.facts.map(f=>({factId:f.id,segments:[{sourceText:f.text,kind:'literal',reason:'x'.repeat(3000)}]}))}}});
 await expect(invoke()).rejects.toThrow('CONTEXT_LIMIT');await expect(invoke()).rejects.toThrow('CONTEXT_LIMIT');expect(proposals).toBe(1);
 expect(await f.projects.store.listKeys!(`projects/${f.projectId}/operations/${f.operationId}/effects/content-requirements`,1)).toHaveLength(1);await expect(f.projects.store.readFresh(`projects/${f.projectId}/budget`)).rejects.toThrow();
 }finally{await rm(f.root,{recursive:true,force:true})}
});
