import {it,expect,beforeEach,afterEach,vi} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {FileStore} from '@/services/video/storage/file-store';
import {ProjectStore} from '@/services/video/storage/project-store';
import {issueSession,ownerHash} from '@/services/video/access/session';
import {writeWorkerHeartbeat} from '@/services/video/commands/worker-heartbeat';
import {budgetKeys} from '@/services/video/config/environment';
import {updateJson} from '@/services/video/storage/atomic-store';
import {initialUnderstanding} from '@/contracts/video/domain';
import type {ProjectControl} from '@/contracts/video/project';
import {POST} from '@/app/api/video/projects/[projectId]/preview/route';
let root:string;
const origin='https://video.test',keys={current:'a'.repeat(64),keyId:'v1',environment:'test'},sid='1'.repeat(64);
beforeEach(async()=>{
 root=await mkdtemp(join(tmpdir(),'vb-preview-route-'));
 for(const [key,value] of Object.entries({VIDEO_DATA_DIR:root,VIDEO_APP_ORIGIN:origin,VIDEO_SESSION_SIGNING_KEY:keys.current,VIDEO_SESSION_KEY_ID:keys.keyId,VIDEO_ENVIRONMENT:keys.environment,VIDEO_GENERATION_ENABLED:'true',MODEL_API_KEY:'local-protocol-only',VIDEO_DIRECTOR_MODEL:'local-protocol-only',...Object.fromEntries(budgetKeys.map(key=>[key,'100000']))}))vi.stubEnv(key,value);
});
afterEach(async()=>{vi.unstubAllEnvs();await rm(root,{recursive:true,force:true})});
async function setup(){
 const projects=new ProjectStore(new FileStore(root)),{projectId}=await projects.create(ownerHash(sid,keys),{schemaVersion:5,clientCommandId:crypto.randomUUID(),clientCreateId:crypto.randomUUID()}),u={...initialUnderstanding(),subject:'真实读书活动',preferences:{...initialUnderstanding().preferences,styleSlug:'crayon-book',voiceMode:'none' as const}};
 const ref=await projects.index.immutable(`projects/${projectId}/understanding/0`,u);
 await updateJson(projects.store,`projects/${projectId}/control`,(c:ProjectControl)=>({...c,understandingRef:ref}));
 const input={schemaVersion:5,clientCommandId:crypto.randomUUID(),expectedBriefVersion:0},context={params:Promise.resolve({projectId})};
 function request(body=input,sessionId=sid,requestOrigin=origin){return new Request(`${origin}/api/video/projects/${projectId}/preview`,{method:'POST',headers:{origin:requestOrigin,'Content-Type':'application/json',cookie:`vb-session=${issueSession(keys,Date.now(),sessionId).token}`},body:JSON.stringify(body)})}
 return{projects,projectId,input,context,request};
}
it('an explicit preview request commits one durable operation and replays without a model in HTTP',async()=>{
 const f=await setup();await writeWorkerHeartbeat(root);
 const response=await POST(f.request(),f.context);expect(response.status).toBe(202);const receipt=await response.json();
 const replay=await POST(f.request(),f.context);expect((await replay.json()).operationId).toBe(receipt.operationId);
 expect((await f.projects.access(ownerHash(sid,keys),f.projectId)).activeProduction).toBe(receipt.operationId);
});
it('preview creation rejects foreign owners, forbidden origin and missing worker',async()=>{
 const f=await setup();
 expect((await POST(f.request(f.input,'2'.repeat(64)),f.context)).status).toBe(404);
 expect((await POST(f.request(f.input,sid,'https://foreign.test'),f.context)).status).toBe(403);
 expect((await POST(f.request(),f.context)).status).toBe(503);
 expect((await f.projects.access(ownerHash(sid,keys),f.projectId)).activeProduction).toBeUndefined();
});
it('a stale preview brief returns a semantic conflict without reserving production',async()=>{
 const f=await setup();await writeWorkerHeartbeat(root);
 const response=await POST(f.request({...f.input,expectedBriefVersion:1}),f.context);
 expect(response.status).toBe(409);expect((await response.json()).error).toMatchObject({code:'BRIEF_CONFLICT',retryable:false});
 expect((await f.projects.access(ownerHash(sid,keys),f.projectId)).activeProduction).toBeUndefined();
});
