import {it,expect,beforeEach,afterEach,vi} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {FileStore} from '@/services/video/storage/file-store';
import {ProjectStore} from '@/services/video/storage/project-store';
import {issueSession,ownerHash} from '@/services/video/access/session';
import {DELETE,GET} from '@/app/api/video/projects/[projectId]/route';
let root:string;
const origin='https://video.test',keys={current:'a'.repeat(64),keyId:'v1',environment:'test'},sid='1'.repeat(64);
beforeEach(async()=>{root=await mkdtemp(`${tmpdir()}/vb-delete-route-`);for(const [k,v] of Object.entries({VIDEO_DATA_DIR:root,VIDEO_APP_ORIGIN:origin,VIDEO_SESSION_SIGNING_KEY:keys.current,VIDEO_SESSION_KEY_ID:keys.keyId,VIDEO_ENVIRONMENT:keys.environment}))vi.stubEnv(k,v)});
afterEach(async()=>{vi.unstubAllEnvs();await rm(root,{recursive:true,force:true})});
async function setup(){
 const {projectId}=await new ProjectStore(new FileStore(root)).create(ownerHash(sid,keys),{schemaVersion:5,clientCreateId:crypto.randomUUID(),clientCommandId:crypto.randomUUID()}),input={schemaVersion:5,clientCommandId:crypto.randomUUID()},context={params:Promise.resolve({projectId})};
 const request=(sessionId=sid,requestOrigin=origin,value:unknown=input)=>new Request(`${origin}/api/video/projects/${projectId}`,{method:'DELETE',headers:{origin:requestOrigin,'Content-Type':'application/json',cookie:`vb-session=${issueSession(keys,Date.now(),sessionId).token}`},body:JSON.stringify(value)});
 return{input,context,request};
}
it('real filesystem route accepts and cold-replays the original deletion, with private no-store and forbidden new access',async()=>{
 const f=await setup(),first=await DELETE(f.request(),f.context);expect(first.status).toBe(202);expect(first.headers.get('Cache-Control')).toBe('private, no-store');const receipt=await first.json();expect(receipt).toMatchObject({commandId:f.input.clientCommandId,status:'cancelling'});
 const replay=await DELETE(f.request(),f.context);expect(replay.status).toBe(202);expect(await replay.json()).toEqual(receipt);expect((await GET(f.request(),f.context)).status).toBe(404);
});
it('wrong owner, wrong origin and malformed command cannot tombstone a live project',async()=>{
 const f=await setup();expect((await DELETE(f.request('2'.repeat(64)),f.context)).status).toBe(404);expect((await DELETE(f.request(sid,'https://foreign.test'),f.context)).status).toBe(403);expect((await DELETE(f.request(sid,origin,{...f.input,extra:'unexpected'}),f.context)).status).toBe(400);expect((await GET(f.request(),f.context)).status).toBe(200);
});
it('recover coordinates own expired resources and returns 410 without accepting new production',async()=>{
 const {POST}=await import('@/app/api/video/projects/[projectId]/recover/route'),{updateJson}=await import('@/services/video/storage/atomic-store');const f=await setup(),{projectId}=await f.context.params,store=new FileStore(root),op=crypto.randomUUID();
 await store.create(`projects/${projectId}/operations/${op}`,{id:op,projectId,status:'queued',canonicalRunId:null,fence:0});
 await updateJson(store,`projects/${projectId}/control`,(c:import('@/contracts/video/project').ProjectControl)=>({...c,expiresAt:'2026-01-01T00:00:00Z',activeProduction:op}));
 const recoverRequest=(sessionId=sid)=>new Request(`${origin}/api/video/projects/${projectId}/recover`,{method:'POST',headers:{origin,'Content-Type':'application/json',cookie:`vb-session=${issueSession(keys,Date.now(),sessionId).token}`},body:JSON.stringify(f.input)});
 expect((await POST(recoverRequest('2'.repeat(64)),f.context)).status).toBe(404);expect((await store.readFresh<{deletedAt?:string}>(`projects/${projectId}/control`)).value.deletedAt).toBeUndefined();
 expect((await POST(recoverRequest(),f.context)).status).toBe(410);expect((await POST(recoverRequest(),f.context)).status).toBe(410);expect((await GET(f.request(),f.context)).status).toBe(410);expect((await DELETE(f.request(),f.context)).status).toBe(410);
 expect((await store.readFresh(`projects/${projectId}/operations/${op}`)).value).toMatchObject({status:'cancelled',fence:1});
});
it('recover continues from a fresh retained result after an initial stale expiry read',async()=>{
 const {POST}=await import('@/app/api/video/projects/[projectId]/recover/route'),{updateJson}=await import('@/services/video/storage/atomic-store');const f=await setup(),{projectId}=await f.context.params,store=new FileStore(root);
 await updateJson(store,`projects/${projectId}/control`,(c:import('@/contracts/video/project').ProjectControl)=>({...c,expiresAt:'2026-01-01T00:00:00Z'}));
 const original=ProjectStore.prototype.access;let raced=false;const spy=vi.spyOn(ProjectStore.prototype,'access').mockImplementation(async function(this:ProjectStore,owner,id){try{return await original.call(this,owner,id)}catch(error){if(!raced&&error instanceof Error&&error.message==='PROJECT_EXPIRED'){raced=true;await updateJson(store,`projects/${projectId}/control`,(c:import('@/contracts/video/project').ProjectControl)=>({...c,expiresAt:'2030-01-01T00:00:00Z'}))}throw error}});
 try{const response=await POST(new Request(`${origin}/api/video/projects/${projectId}/recover`,{method:'POST',headers:{origin,'Content-Type':'application/json',cookie:`vb-session=${issueSession(keys,Date.now(),sid).token}`},body:JSON.stringify(f.input)}),f.context);expect(response.status).toBe(200);expect(await response.json()).toEqual({status:'idle'});expect((await store.readFresh<{deletedAt?:string}>(`projects/${projectId}/control`)).value.deletedAt).toBeUndefined()}finally{spy.mockRestore()}
});
