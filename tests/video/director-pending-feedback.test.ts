import {expect,it} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {FileStore} from '@/services/video/storage/file-store';
import {ProjectStore} from '@/services/video/storage/project-store';
import {updateJson} from '@/services/video/storage/atomic-store';
import type {ProjectControl} from '@/contracts/video/project';
import {LocalEventLog} from '@/services/video/stream/local-event-log';
import {runDirectorOperation} from '@/services/video/commands/local-director';
import {cancelProduction} from '@/services/video/commands/cancel';

it.each(['running','cancelled','new_baseline'])('defers chat corrections against the original semantic baseline during %s',async scenario=>{
 const cancel=scenario==='cancelled',race=scenario==='new_baseline';
 const root=await mkdtemp(join(tmpdir(),'vb-pending-feedback-'));
 try{
  const store=new FileStore(root),projects=new ProjectStore(store),events=new LocalEventLog(root);
  const {projectId}=await projects.create('owner',{schemaVersion:5,clientCommandId:crypto.randomUUID(),clientCreateId:crypto.randomUUID()});
  const operationId=crypto.randomUUID(),productionId=crypto.randomUUID(),userId=crypto.randomUUID();
  await store.create(`projects/${projectId}/operations/${operationId}`,{id:operationId,projectId,kind:'chat',status:'reserved',canonicalRunId:null,streamEpoch:0,fence:0});
  await store.create(`projects/${projectId}/operations/${productionId}`,{id:productionId,kind:'render',status:'running',streamEpoch:0});
  await updateJson(store,`projects/${projectId}/control`,(c:ProjectControl)=>({...c,phase:'rendering' as const,activeConversation:operationId,activeProduction:race?null:productionId,ordinalReservations:{[operationId]:{user:1,assistant:2}}}));
  await projects.archiveMessage(projectId,{id:userId,ordinal:1,role:'user',text:'下一版换成水墨风格',status:'completed',contentVersion:1,operationId});
  const before=await projects.access('owner',projectId);
  let frozen=before;
  let calls=0;
  const decide=async()=>{
   calls++;
   if(race){
    const understanding=(await store.readFresh<Record<string,unknown>>(before.understandingRef.key)).value;
    const ref=await projects.index.immutable(`projects/${projectId}/understanding/1`,{...understanding,briefVersion:1});
    await updateJson(store,`projects/${projectId}/control`,(c:ProjectControl)=>({...c,briefVersion:1,understandingRef:ref,activeProduction:productionId}));
    frozen=await projects.access('owner',projectId);
   }
   if(cancel)await updateJson(store,`projects/${projectId}/control`,(c:ProjectControl)=>({...c,activeProduction:null,consentEpoch:c.consentEpoch+1,phase:'cancelled' as const}));
   return{action:'change' as const,reply:'已记下，作为下一次修改。',effect:'pending_followup' as const,executionIntent:'none' as const,evidenceMessageIds:[userId],understandingPatch:{baseBriefVersion:0,operations:[{op:'set_preference' as const,field:'styleSlug' as const,value:'ink-wash',sourceMessageIds:[userId]}]}};
  };
  await runDirectorOperation(store,events,projectId,operationId,{decide,limits:{projectCalls:10,projectInputTokens:100000,projectOutputTokens:10000,dailyCalls:10}});
  const after=await projects.access('owner',projectId);
  expect(after.briefVersion).toBe(frozen.briefVersion);expect(after.understandingRef).toEqual(frozen.understandingRef);
  expect(after.pendingFeedbackIndexRef).toBeTruthy();
  const entries=await projects.index.all(after.pendingFeedbackIndexRef!);expect(entries).toHaveLength(1);
  const feedback=(await store.readFresh(entries[0].ref.key)).value;
  expect(feedback).toMatchObject({schemaVersion:5,operationId,userMessageIds:[userId],baseline:{productionOperationId:productionId,briefVersion:0,consentEpoch:0},execution:'not_started'});
  const view=await projects.view('owner',projectId);expect(view.pendingInputs).toEqual(cancel||race?[]:[userId]);
  await runDirectorOperation(new FileStore(root),new LocalEventLog(root),projectId,operationId,{decide});
  expect(calls).toBe(1);expect(await projects.index.all(after.pendingFeedbackIndexRef!)).toHaveLength(1);
 }finally{await rm(root,{recursive:true,force:true})}
});
it('recovers a completed Director effect after power loss and production cancellation without new model calls or applying the old patch',async()=>{
 const root=await mkdtemp(join(tmpdir(),'vb-pending-cold-'));
 try{
  const store=new FileStore(root),projects=new ProjectStore(store),events=new LocalEventLog(root);
  const {projectId}=await projects.create('owner',{schemaVersion:5,clientCommandId:crypto.randomUUID(),clientCreateId:crypto.randomUUID()});
  const operationId=crypto.randomUUID(),productionId=crypto.randomUUID(),userId=crypto.randomUUID(),prefix=`projects/${projectId}`;
  await store.create(`${prefix}/operations/${operationId}`,{id:operationId,projectId,kind:'chat',status:'reserved',canonicalRunId:null,streamEpoch:0,fence:0});
  await store.create(`${prefix}/operations/${productionId}`,{id:productionId,kind:'render',status:'running',canonicalRunId:productionId,streamEpoch:0,fence:0});
  await updateJson(store,`${prefix}/control`,(c:ProjectControl)=>({...c,phase:'rendering' as const,activeConversation:operationId,activeProduction:productionId,ordinalReservations:{[operationId]:{user:1,assistant:2}}}));
  await projects.archiveMessage(projectId,{id:userId,ordinal:1,role:'user',text:'下一版换成水墨',status:'completed',contentVersion:1,operationId});
  let offline=false,calls=0;
  const durableCas=store.cas.bind(store),durableRead=store.readFresh.bind(store);
  store.readFresh=async<T>(key:string)=>{if(offline)throw Error('POWER_LOSS');return durableRead<T>(key)};
  store.cas=async<T>(key:string,etag:string,value:T)=>{
   await durableCas(key,etag,value);
   if(key===`${prefix}/operations/${operationId}/effects/director`&&typeof value==='object'&&value!==null&&'status' in value&&value.status==='completed'){offline=true;throw Error('POWER_LOSS')}
  };
  const decide=async()=>{calls++;return{action:'change' as const,reply:'已记下，下一版再修改。',effect:'pending_followup' as const,executionIntent:'none' as const,evidenceMessageIds:[userId],understandingPatch:{baseBriefVersion:0,operations:[{op:'set_preference' as const,field:'styleSlug' as const,value:'ink-wash',sourceMessageIds:[userId]}]}}};
  const limits={projectCalls:10,projectInputTokens:100000,projectOutputTokens:10000,dailyCalls:10};
  await expect(runDirectorOperation(store,events,projectId,operationId,{decide,limits})).rejects.toThrow('POWER_LOSS');
  const cold=new FileStore(root);await cancelProduction(cold,projectId,productionId);
  await runDirectorOperation(cold,new LocalEventLog(root),projectId,operationId,{decide,limits});
  const recoveredProjects=new ProjectStore(cold),control=await recoveredProjects.access('owner',projectId);
  expect(calls).toBe(1);expect(control.briefVersion).toBe(0);expect(control.phase).toBe('cancelled');expect(control.consentEpoch).toBe(1);
  const [entry]=await recoveredProjects.index.all(control.pendingFeedbackIndexRef!);
  expect((await cold.readFresh(entry.ref.key)).value).toMatchObject({baseline:{productionOperationId:productionId,briefVersion:0,consentEpoch:0},execution:'not_started'});
  expect((await recoveredProjects.view('owner',projectId)).pendingInputs).toEqual([]);
  expect((await recoveredProjects.messages(control)).at(-1)?.status).toBe('completed');
  expect((await cold.readFresh<{calls:number}>(`${prefix}/budget`)).value.calls).toBe(1);
 }finally{await rm(root,{recursive:true,force:true})}
});
it('saves a pending music-volume request even when the Director has no UnderstandingPatch for that field',async()=>{
 const root=await mkdtemp(join(tmpdir(),'vb-pending-music-'));
 try{
  const store=new FileStore(root),projects=new ProjectStore(store),events=new LocalEventLog(root);
  const {projectId}=await projects.create('owner',{schemaVersion:5,clientCommandId:crypto.randomUUID(),clientCreateId:crypto.randomUUID()});
  const operationId=crypto.randomUUID(),productionId=crypto.randomUUID(),userId=crypto.randomUUID();
  await store.create(`projects/${projectId}/operations/${operationId}`,{id:operationId,projectId,kind:'chat',status:'reserved',canonicalRunId:null,streamEpoch:0,fence:0});
  await updateJson(store,`projects/${projectId}/control`,(c:ProjectControl)=>({...c,activeConversation:operationId,activeProduction:productionId}));
  await projects.archiveMessage(projectId,{id:userId,ordinal:1,role:'user',text:'下一版音乐调小一点',status:'completed',contentVersion:1,operationId});
  await runDirectorOperation(store,events,projectId,operationId,{decide:async(_u,_m,_max,options)=>{
   expect(options?.projectContext?.activeProductionId).toBe(productionId);
   return{action:'change',reply:'已记下，下一次修改时音乐调小。',effect:'pending_followup',executionIntent:'none',evidenceMessageIds:[userId]};
  },limits:{projectCalls:10,projectInputTokens:100000,projectOutputTokens:10000,dailyCalls:10}});
  const after=await projects.access('owner',projectId);expect(after.pendingFeedbackIndexRef).toBeTruthy();
  const [entry]=await projects.index.all(after.pendingFeedbackIndexRef!);
  expect((await store.readFresh(entry.ref.key)).value).toMatchObject({userMessageIds:[userId],execution:'not_started'});
 }finally{await rm(root,{recursive:true,force:true})}
});
