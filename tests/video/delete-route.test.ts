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
