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
import {applyPendingDirectorFeedback,pendingFeedbackMessageIds,deferDirectorFeedback} from '@/services/video/revisions/pending-feedback';
import type {Understanding} from '@/contracts/video/domain';

it('applies next-version patches in message order after publication, keeping the produced version frozen',async()=>{
 const root=await mkdtemp(join(tmpdir(),'vb-pending-apply-'));
 try{
  const store=new FileStore(root),projects=new ProjectStore(store),events=new LocalEventLog(root),productionId=crypto.randomUUID();
  const {projectId}=await projects.create('owner',{schemaVersion:5,clientCommandId:crypto.randomUUID(),clientCreateId:crypto.randomUUID()});
  await updateJson(store,`projects/${projectId}/control`,(c:ProjectControl)=>({...c,activeProduction:productionId}));
  const before=await projects.access('owner',projectId),userIds:string[]=[];
  for(const [index,style] of ['ink-wash','papercut-red'].entries()){
   const operationId=crypto.randomUUID(),userId=crypto.randomUUID();userIds.push(userId);
   await store.create(`projects/${projectId}/operations/${operationId}`,{id:operationId,projectId,kind:'chat',status:'reserved',canonicalRunId:null,streamEpoch:0,fence:0});
   await updateJson(store,`projects/${projectId}/control`,(c:ProjectControl)=>({...c,activeConversation:operationId,ordinalReservations:{...c.ordinalReservations,[operationId]:{user:index*2+1,assistant:index*2+2}}}));
   await projects.archiveMessage(projectId,{id:userId,ordinal:index*2+1,role:'user',text:`下一版用${style}`,status:'completed',contentVersion:1,operationId});
   await runDirectorOperation(store,events,projectId,operationId,{decide:async()=>({action:'change',reply:'已记下，下一版再修改。',effect:'pending_followup',executionIntent:'none',evidenceMessageIds:[userId],understandingPatch:{baseBriefVersion:0,operations:[{op:'set_preference',field:'styleSlug',value:style,sourceMessageIds:[userId]}]}}),limits:{projectCalls:10,projectInputTokens:100000,projectOutputTokens:10000,dailyCalls:10}});
  }
  expect((await projects.access('owner',projectId)).understandingRef).toEqual(before.understandingRef);
  const resultId=crypto.randomUUID();await updateJson(store,`projects/${projectId}/control`,(c:ProjectControl)=>({...c,activeProduction:null,currentResultId:resultId,phase:'ready' as const}));
  expect(await pendingFeedbackMessageIds(projects,await projects.access('owner',projectId))).toEqual(userIds);
  await applyPendingDirectorFeedback(projects,projectId);
  const after=await projects.access('owner',projectId),understanding=(await store.readFresh<Understanding>(after.understandingRef.key)).value;
  expect(after.briefVersion).toBe(2);expect(understanding.preferences.styleSlug).toBe('papercut-red');expect(after.currentResultId).toBe(resultId);expect(after.phase).toBe('ready');
  expect((await store.readFresh<Understanding>(before.understandingRef.key)).value.preferences.styleSlug).toBeNull();
  expect(await pendingFeedbackMessageIds(projects,after)).toEqual([]);
  await applyPendingDirectorFeedback(new ProjectStore(new FileStore(root)),projectId);expect((await projects.access('owner',projectId)).understandingRef).toEqual(after.understandingRef);
 }finally{await rm(root,{recursive:true,force:true})}
});

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
it('asks for clarification instead of promising an unrepresented next-version change',async()=>{
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
  const after=await projects.access('owner',projectId);expect(after.pendingFeedbackIndexRef).toBeUndefined();
  expect((await projects.messages(after)).at(-1)?.text).toContain('这条修改还未写入下一版，具体想改哪一处？');
  expect(after.briefVersion).toBe(0);
 }finally{await rm(root,{recursive:true,force:true})}
});
it('keeps a historical patchless request unresolved until a later applied patch cites that request',async()=>{
 const root=await mkdtemp(join(tmpdir(),'vb-pending-clarify-'));
 try{
  const store=new FileStore(root),projects=new ProjectStore(store),events=new LocalEventLog(root),{projectId}=await projects.create('owner',{schemaVersion:5,clientCommandId:crypto.randomUUID(),clientCreateId:crypto.randomUUID()});
  const oldOperationId=crypto.randomUUID(),oldUserId=crypto.randomUUID(),productionId=crypto.randomUUID();
  await projects.archiveMessage(projectId,{id:oldUserId,ordinal:1,role:'user',text:'下一版换一个感觉',status:'completed',contentVersion:1,operationId:oldOperationId});
  const initial=await projects.access('owner',projectId),ref=await deferDirectorFeedback(projects,initial,{...initial,activeProduction:productionId},oldOperationId,await projects.messages(initial),undefined);
  await updateJson(store,`projects/${projectId}/control`,(c:ProjectControl)=>({...c,pendingFeedbackIndexRef:ref}));
  await applyPendingDirectorFeedback(projects,projectId);expect(await pendingFeedbackMessageIds(projects,await projects.access('owner',projectId))).toEqual([oldUserId]);
  const operationId=crypto.randomUUID(),userId=crypto.randomUUID();
  await store.create(`projects/${projectId}/operations/${operationId}`,{id:operationId,projectId,kind:'chat',status:'reserved',canonicalRunId:null,streamEpoch:0,fence:0});
  await updateJson(store,`projects/${projectId}/control`,(c:ProjectControl)=>({...c,activeConversation:operationId,ordinalReservations:{[operationId]:{user:2,assistant:3}}}));
  await projects.archiveMessage(projectId,{id:userId,ordinal:2,role:'user',text:'我刚才说的感觉是水墨',status:'completed',contentVersion:1,operationId});
  await runDirectorOperation(store,events,projectId,operationId,{decide:async(_u,_m,_max,options)=>{
   expect(options?.projectContext?.pendingFeedbackMessageIds).toEqual([oldUserId]);
   return{action:'change',reply:'已改成水墨。',effect:'update_brief',executionIntent:'none',evidenceMessageIds:[oldUserId,userId],understandingPatch:{baseBriefVersion:0,operations:[{op:'set_preference',field:'styleSlug',value:'ink-wash',sourceMessageIds:[oldUserId,userId]}]}};
  },limits:{projectCalls:10,projectInputTokens:100000,projectOutputTokens:10000,dailyCalls:10}});
  const after=await projects.access('owner',projectId);expect(after.briefVersion).toBe(1);expect(await pendingFeedbackMessageIds(projects,after)).toEqual([]);
 }finally{await rm(root,{recursive:true,force:true})}
});
