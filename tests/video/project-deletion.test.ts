import {beforeEach,afterEach,it,expect} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {FileStore} from './helpers/file-store';
import {ProjectStore} from '@/services/video/storage/project-store';
import {updateJson} from '@/services/video/storage/atomic-store';
import type {ProjectControl} from '@/contracts/video/project';
import {deleteProject,reconcileDeletedProject} from '@/services/video/commands/delete-project';
let root:string,store:FileStore,projects:ProjectStore;
beforeEach(async()=>{root=await mkdtemp(`${tmpdir()}/vb-delete-`);store=new FileStore(root);projects=new ProjectStore(store)});
afterEach(async()=>{await rm(root,{recursive:true,force:true})});
async function create(owner='a'){return(await projects.create(owner,{schemaVersion:5,clientCreateId:crypto.randomUUID(),clientCommandId:crypto.randomUUID()})).projectId}
const request=()=>({schemaVersion:5 as const,clientCommandId:crypto.randomUUID()});
it('cold replay retains the original tombstone receipt without revoking twice',async()=>{
 const id=await create(),command=request();const first=await deleteProject(store,'a',id,command);
 expect(first).toMatchObject({status:'cancelling',commandId:command.clientCommandId,projectId:id,controlVersion:1});
 expect(await deleteProject(new FileStore(root),'a',id,command)).toEqual(first);
 const control=(await store.readFresh<ProjectControl>(`projects/${id}/control`)).value;expect(control.consentEpoch).toBe(1);expect(control.controlVersion).toBe(1);
 await expect(projects.view('a',id)).rejects.toThrow('ACCESS_NOT_FOUND');
 await expect(deleteProject(store,'b',id,command)).rejects.toThrow('ACCESS_NOT_FOUND');
 await expect(deleteProject(store,'a',id,request())).rejects.toThrow('ACCESS_NOT_FOUND');
});
it('cancels unclaimed jobs, fences running and detached exports, and preserves terminal jobs and other projects',async()=>{
 const id=await create(),other=await create(),ids=Array.from({length:4},()=>crypto.randomUUID());
 for(const [index,op] of ids.entries())await store.create(`projects/${id}/operations/${op}`,{id:op,projectId:id,kind:index===2?'export':'render',status:['reserved','running','queued','succeeded'][index],fence:7,canonicalRunId:index===1?'live':null});
 await store.create(`projects/${other}/operations/${ids[0]}`,{id:ids[0],projectId:other,kind:'render',status:'running',fence:7,canonicalRunId:'other'});
 await updateJson(store,`projects/${id}/control`,(c:ProjectControl)=>({...c,activeProduction:ids[1]}));
 await deleteProject(store,'a',id,request());
 expect(await reconcileDeletedProject(store,id)).toEqual({status:'cancelling',operationsPending:1});
 for(const [index,op] of ids.entries())expect((await store.readFresh(`projects/${id}/operations/${op}`)).value).toMatchObject({status:['cancelled','cancelling','cancelled','succeeded'][index],fence:index===3?7:8});
 expect((await store.readFresh(`projects/${other}/operations/${ids[0]}`)).value).toMatchObject({status:'running',fence:7});
 expect((await store.readFresh<ProjectControl>(`projects/${id}/control`)).value.activeProduction).toBeNull();
});
it('a cancellation write failure leaves a recoverable command and preserves accounting',async()=>{
 const id=await create(),op=crypto.randomUUID(),command=request(),key=`projects/${id}/operations/${op}`;
 await store.create(key,{id:op,projectId:id,kind:'chat',status:'running',fence:0,canonicalRunId:'live'});
 await store.create(`projects/${id}/budget`,{modelCalls:8,modelOutputTokens:78879});
 const faulty={readFresh:store.readFresh.bind(store),create:store.create.bind(store),listKeys:store.listKeys.bind(store),cas:async<T>(k:string,e:string,v:T)=>{if(k===key)throw Error('disk offline');await store.cas(k,e,v)}};
 await expect(deleteProject(faulty,'a',id,command)).rejects.toThrow('disk offline');
 await expect(projects.view('a',id)).rejects.toThrow('ACCESS_NOT_FOUND');
 expect(await deleteProject(new FileStore(root),'a',id,command)).toMatchObject({status:'cancelling',commandId:command.clientCommandId});
 expect((await store.readFresh(`projects/${id}/budget`)).value).toEqual({modelCalls:8,modelOutputTokens:78879});
});
it('rejects a foreign operation binding without changing it and never claims resource cleanup complete',async()=>{
 const id=await create(),op=crypto.randomUUID();await store.create(`projects/${id}/operations/${op}`,{id:op,projectId:crypto.randomUUID(),status:'running',fence:1,canonicalRunId:'live'});
 const command=request();await expect(deleteProject(store,'a',id,command)).rejects.toThrow('DELETION_RECORD_INVALID');
 expect((await store.readFresh(`projects/${id}/operations/${op}`)).value).toMatchObject({status:'running',fence:1});
});
it('an empty operation inventory still means cancelling until physical cleanup is implemented',async()=>{
 const id=await create();await deleteProject(store,'a',id,request());expect(await reconcileDeletedProject(store,id)).toEqual({status:'cancelling',operationsPending:0});
});
it('concurrent duplicate admission returns one receipt and increments consent once',async()=>{
 const id=await create(),command=request();const receipts=await Promise.all([deleteProject(store,'a',id,command),deleteProject(new FileStore(root),'a',id,command)]);
 expect(receipts[0]).toEqual(receipts[1]);expect((await store.readFresh<ProjectControl>(`projects/${id}/control`)).value.consentEpoch).toBe(1);
});
it('an existing different command ID cannot be repurposed to delete',async()=>{
 const id=await create(),command=request();await store.create(`projects/${id}/commands/${command.clientCommandId}`,{hash:'other-command'});
 await expect(deleteProject(store,'a',id,command)).rejects.toThrow('IDEMPOTENCY_CONFLICT');expect((await projects.view('a',id)).phase).toBe('collecting');
});
it('cold sweeps isolate corrupt projects, cancel healthy tombstones and skip live projects',async()=>{
 const {reconcileDeletedProjects}=await import('@/services/video/commands/delete-project');
 const healthy=await create(),broken=await create(),live=await create(),op=crypto.randomUUID();
 for(const id of [healthy,broken,live])await store.create(`projects/${id}/operations/${op}`,{id:op,projectId:id===broken?live:id,status:'queued',canonicalRunId:null,fence:0});
 await projects.tombstone('a',healthy);await projects.tombstone('a',broken);
 expect(await reconcileDeletedProjects(new FileStore(root))).toEqual({reconciled:1,failed:1});
 expect((await store.readFresh(`projects/${healthy}/operations/${op}`)).value).toMatchObject({status:'cancelled',fence:1});
 expect((await store.readFresh(`projects/${live}/operations/${op}`)).value).toMatchObject({status:'queued',fence:0});
});
