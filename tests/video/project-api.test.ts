import {it,expect,beforeEach,afterEach} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';import{tmpdir}from'node:os';
import{FileStore}from'./helpers/file-store';
import{ProjectStore}from'@/services/video/storage/project-store';
let dir:string;beforeEach(async()=>dir=await mkdtemp(`${tmpdir()}/vb-project-`));afterEach(async()=>{await rm(dir,{recursive:true,force:true})});
it('owner/create ID yields one project across cold instances',async()=>{
 const store=new FileStore(dir);const a=new ProjectStore(store),b=new ProjectStore(store);
 const request={schemaVersion:5 as const,clientCommandId:crypto.randomUUID(),clientCreateId:crypto.randomUUID(),title:'新视频'};
 const ids=await Promise.all([a.create('owner-a',request),b.create('owner-a',request)]);expect(ids[0].projectId).toBe(ids[1].projectId);
 await expect(b.view('owner-b',ids[0].projectId)).rejects.toThrow('ACCESS_NOT_FOUND');
 const view=await b.view('owner-a',ids[0].projectId);expect(view.phase).toBe('collecting');expect(view.understanding.summary).toEqual([]);expect(JSON.stringify(view)).not.toContain('ownerKeyHash');
});
it('archives simultaneous messages without loss, and a cold view retains final messages',async()=>{
 const store=new FileStore(dir),projects=new ProjectStore(store);const{projectId}=await projects.create('owner-a',{schemaVersion:5,clientCommandId:crypto.randomUUID(),clientCreateId:crypto.randomUUID()});
 await Promise.all([projects.archiveMessage(projectId,{id:crypto.randomUUID(),ordinal:1,role:'user',text:'你好',status:'completed',contentVersion:1}),projects.archiveMessage(projectId,{id:crypto.randomUUID(),ordinal:2,role:'assistant',text:'实际回复',status:'completed',contentVersion:1})]);
 const view=await new ProjectStore(new FileStore(dir)).view('owner-a',projectId);expect(view.messages.map(m=>m.text)).toEqual(['你好','实际回复']);
});
it('deleted projects cannot be read even when files still exist',async()=>{
 const projects=new ProjectStore(new FileStore(dir));const{projectId}=await projects.create('a',{schemaVersion:5,clientCommandId:crypto.randomUUID(),clientCreateId:crypto.randomUUID()});
 await projects.tombstone('a',projectId);await expect(projects.view('a',projectId)).rejects.toThrow('ACCESS_NOT_FOUND');
});
it('a post-publication failure cannot replace a completed reply with empty interrupted content',async()=>{
 const projects=new ProjectStore(new FileStore(dir));const{projectId}=await projects.create('a',{schemaVersion:5,clientCommandId:crypto.randomUUID(),clientCreateId:crypto.randomUUID()});const id=crypto.randomUUID();
 await projects.archiveMessage(projectId,{id,ordinal:2,role:'assistant',text:'已保存的实际回复',status:'completed',contentVersion:1});
 await projects.archiveMessage(projectId,{id,ordinal:2,role:'assistant',text:'',status:'interrupted',contentVersion:1});
 expect((await projects.view('a',projectId)).messages[0]).toMatchObject({text:'已保存的实际回复',status:'completed'});
});
it('missing private resources use the same 404 as unauthorized resources',async()=>{
 const {errorResponse}=await import('@/services/video/http/route-utils');const {StoreMissing}=await import('@/services/video/storage/atomic-store');
 const response=errorResponse(new StoreMissing());expect(response.status).toBe(404);expect((await response.json()).error.code).toBe('ACCESS_NOT_FOUND');
});
it('recent project lookup filters foreign, deleted and absent IDs without exposing them',async()=>{
 const projects=new ProjectStore(new FileStore(dir));const request=()=>({schemaVersion:5 as const,clientCommandId:crypto.randomUUID(),clientCreateId:crypto.randomUUID()});
 const own=await projects.create('a',request()),foreign=await projects.create('b',request()),deleted=await projects.create('a',request());await projects.tombstone('a',deleted.projectId);
 const result=await projects.lookup('a',[own.projectId,foreign.projectId,deleted.projectId,crypto.randomUUID()]);expect(result.map(p=>p.projectId)).toEqual([own.projectId]);expect(JSON.stringify(result)).not.toContain('ownerKeyHash');
});
