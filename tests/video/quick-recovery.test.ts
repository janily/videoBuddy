import {afterEach,expect,it,vi} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
const {confirm,build}=vi.hoisted(()=>({confirm:vi.fn(),build:vi.fn()}));
vi.mock('@/services/video/media/recovery',()=>({confirmOperationStopped:confirm}));
vi.mock('@/services/video/quick/film',()=>({buildQuickFilm:build}));
import {FileStore} from '@/services/video/storage/file-store';
import {ProjectStore} from '@/services/video/storage/project-store';
import {updateJson} from '@/services/video/storage/atomic-store';
import {LocalEventLog} from '@/services/video/stream/local-event-log';
import {LocalOperationQueue} from '@/services/video/commands/local-queue';
import {runQueuedOnce} from '@/services/video/commands/local-worker';
import {runQuickFilmOperation} from '@/services/video/quick/operation';
import type {ProjectControl} from '@/contracts/video/project';
import {initialUnderstanding} from '@/contracts/video/domain';
import {preparePreview} from '@/services/video/quick/prepare';
const roots:string[]=[];
afterEach(async()=>{confirm.mockReset();build.mockReset();await Promise.all(roots.splice(0).map(root=>rm(root,{recursive:true,force:true})))});
async function fixture(status='running'){
 const root=await mkdtemp(join(tmpdir(),'vb-recovery-'));roots.push(root);const store=new FileStore(root),projects=new ProjectStore(store),events=new LocalEventLog(root),queue=new LocalOperationQueue(store,root);
 const {projectId}=await projects.create('owner',{schemaVersion:5,clientCommandId:randomUUID(),clientCreateId:randomUUID()}),operationId=randomUUID(),prefix=`projects/${projectId}`,key=prefix+'/operations/'+operationId;
 const c=await updateJson(store,prefix+'/control',(c:ProjectControl)=>({...c,phase:'generating' as const,activeProduction:operationId}));
 await store.create(key,{id:operationId,projectId,kind:'preview',commandId:randomUUID(),status,canonicalRunId:randomUUID(),streamEpoch:0,fence:0,revisionId:randomUUID(),previewId:randomUUID(),briefVersion:c.briefVersion,consentEpoch:c.consentEpoch,understandingRef:c.understandingRef,mediaAttemptStarted:true});
 const run=()=>runQuickFilmOperation(store,events,projectId,operationId,{root,env:{},build});
 return{root,store,projects,events,queue,projectId,operationId,prefix,key,run};
}
it.each([false,'throw'])('without stop proof (%s) retains the blocker and never retries models',async failure=>{
 const f=await fixture();confirm.mockImplementation(async()=>{if(failure==='throw')throw Error('SOCKET_UNAVAILABLE');return false});await f.run();
 expect(build).not.toHaveBeenCalled();expect((await f.projects.access('owner',f.projectId)).unresolvedMediaStops).toEqual({[f.operationId]:'preview'});expect((await f.projects.operation(f.projectId,f.operationId))?.status).toBe('interrupted');
});
it('confirmed cold stop releases only its own lane and permits a fresh user attempt',async()=>{
 const f=await fixture();confirm.mockResolvedValue(true);await f.run();
 expect(confirm).toHaveBeenCalledWith(f.root,{}, {projectId:f.projectId,operationId:f.operationId});expect(build).not.toHaveBeenCalled();
 const c=await f.projects.access('owner',f.projectId);expect(c.activeProduction).toBeNull();expect(c.unresolvedMediaStops||{}).toEqual({});expect((await f.projects.operation(f.projectId,f.operationId))?.status).toBe('failed');
 expect((await f.events.readFrom(f.projectId,f.operationId,0)).at(-1)?.event.payload).toMatchObject({status:'failed',errorCode:'RENDER_PROCESS_CRASHED',retryable:true});
 expect((await new ProjectStore(new FileStore(f.root)).view('owner',f.projectId)).productionFailure?.errorCode).toBe('RENDER_PROCESS_CRASHED');
 await f.run();expect(build).not.toHaveBeenCalled();expect(confirm).toHaveBeenCalledTimes(1);
 const understanding=initialUnderstanding();understanding.subject='社区活动';understanding.preferences.styleSlug='watercolor';
 const understandingRef=await f.projects.index.immutable(f.prefix+'/understanding/retry-ready',understanding);await updateJson(f.store,f.prefix+'/control',(c:ProjectControl)=>({...c,understandingRef}));
 const receipt=await preparePreview(f.projects,f.queue,'owner',f.projectId,{schemaVersion:5,clientCommandId:randomUUID(),expectedBriefVersion:0});expect(receipt.operationId).not.toBe(f.operationId);expect(build).not.toHaveBeenCalled();

});
it('rediscovers a completed queue with an unresolved interrupted producer and preserves the historical outcome',async()=>{
 const f=await fixture();confirm.mockResolvedValue(false);await f.run();await f.queue.enqueue(f.projectId,f.operationId,'preview');await f.queue.complete(f.projectId,f.operationId);
 const original=(await f.store.readFresh(f.key+'/preview-outcome')).value;confirm.mockResolvedValue(true);
 await runQueuedOnce(new LocalOperationQueue(new FileStore(f.root),f.root),new FileStore(f.root),()=>f.run());
 expect((await f.store.readFresh(f.key+'/preview-outcome')).value).toEqual(original);expect((await f.projects.access('owner',f.projectId)).unresolvedMediaStops).toEqual({});expect((await f.projects.view('owner',f.projectId)).productionFailure?.errorCode).toBe('RENDER_PROCESS_CRASHED');expect(build).not.toHaveBeenCalled();
 expect(await f.queue.pending()).toEqual([]);
});
it('a confirmed old producer never clears a newer production lane or another blocker',async()=>{
 const f=await fixture('interrupted'),newer=randomUUID();await updateJson(f.store,f.prefix+'/control',(c:ProjectControl):ProjectControl=>({...c,activeProduction:newer,consentEpoch:c.consentEpoch+1,unresolvedMediaStops:{[f.operationId]:'preview',[newer]:'preview'}}));
 confirm.mockResolvedValue(true);await f.run();const c=await f.projects.access('owner',f.projectId);expect(c.activeProduction).toBe(newer);expect(c.unresolvedMediaStops).toEqual({[newer]:'preview'});expect((await f.projects.operation(f.projectId,f.operationId))?.status).toBe('superseded');expect(build).not.toHaveBeenCalled();
});
it('confirmed cancellation stays cancelled after recovery',async()=>{
 const f=await fixture('cancelling');await updateJson(f.store,f.prefix+'/control',(c:ProjectControl):ProjectControl=>({...c,activeProduction:null,cancelRequestedProductionId:f.operationId,phase:'cancelled',unresolvedMediaStops:{[f.operationId]:'preview'}}));confirm.mockResolvedValue(true);await f.run();
 expect((await f.projects.access('owner',f.projectId)).phase).toBe('cancelled');expect((await f.projects.access('owner',f.projectId)).unresolvedMediaStops).toEqual({});expect((await f.projects.operation(f.projectId,f.operationId))?.status).toBe('cancelled');expect(build).not.toHaveBeenCalled();
});
it('retries outcome persistence after the stop proof released a completed queue blocker',async()=>{
 const f=await fixture();confirm.mockResolvedValue(false);await f.run();await f.queue.enqueue(f.projectId,f.operationId,'preview');await f.queue.complete(f.projectId,f.operationId);confirm.mockResolvedValue(true);
 const create=f.store.create.bind(f.store);let fail=true;f.store.create=async(key,value)=>{if(key===f.key+'/media-stop-outcome'&&fail){fail=false;throw Error('ACK_LOST')}return create(key,value)};
 await expect(runQueuedOnce(f.queue,f.store,()=>f.run())).rejects.toThrow('ACK_LOST');expect((await f.projects.access('owner',f.projectId)).unresolvedMediaStops).toEqual({});
 await runQueuedOnce(new LocalOperationQueue(new FileStore(f.root),f.root),new FileStore(f.root),()=>f.run());
 expect((await f.projects.operation(f.projectId,f.operationId))?.status).toBe('failed');expect((await f.projects.view('owner',f.projectId)).productionFailure?.errorCode).toBe('RENDER_PROCESS_CRASHED');expect(build).not.toHaveBeenCalled();expect(await f.queue.pending()).toEqual([]);
});
