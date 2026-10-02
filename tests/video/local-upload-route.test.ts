import {afterEach,beforeEach,expect,it} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {FileStore} from '@/services/video/storage/file-store';
import {ProjectStore} from '@/services/video/storage/project-store';
import {issueSession,ownerHash} from '@/services/video/access/session';
import {POST as reserve} from '@/app/api/video/projects/[projectId]/assets/reserve/route';
import {PUT as upload} from '@/app/api/video/projects/[projectId]/assets/[assetId]/file/route';
import {POST as complete} from '@/app/api/video/projects/[projectId]/assets/[assetId]/complete/route';

let root:string;
const keys={current:'a'.repeat(64),keyId:'v1',environment:'test'};
const origin='https://video.test';
beforeEach(async()=>{root=await mkdtemp(join(tmpdir(),'vb-upload-route-'));process.env.VIDEO_DATA_DIR=root;process.env.VIDEO_APP_ORIGIN=origin;process.env.VIDEO_SESSION_SIGNING_KEY=keys.current;process.env.VIDEO_SESSION_KEY_ID=keys.keyId;process.env.VIDEO_ENVIRONMENT=keys.environment});
afterEach(async()=>{await rm(root,{recursive:true,force:true});delete process.env.VIDEO_DATA_DIR;delete process.env.VIDEO_APP_ORIGIN;delete process.env.VIDEO_SESSION_SIGNING_KEY;delete process.env.VIDEO_SESSION_KEY_ID;delete process.env.VIDEO_ENVIRONMENT});
function headers(token:string,type='application/json'){return{origin,'content-type':type,cookie:`vb-session=${token}`}}

it('reserves, writes and completes private bytes idempotently while denying another owner',async()=>{
 const sid='1'.repeat(64),token=issueSession(keys,Date.now(),sid).token,foreign=issueSession(keys,Date.now(),'2'.repeat(64)).token;
 const {projectId}=await new ProjectStore(new FileStore(root)).create(ownerHash(sid,keys),{schemaVersion:5,clientCommandId:crypto.randomUUID(),clientCreateId:crypto.randomUUID()});
 const input={schemaVersion:5,clientCommandId:crypto.randomUUID(),filename:'资料.md',declaredBytes:100,declaredMime:'text/markdown',intendedUse:'reference',rightsConfirmed:true};
 const context={params:Promise.resolve({projectId})};
 const reserved=await reserve(new Request(`${origin}/api/video/projects/${projectId}/assets/reserve`,{method:'POST',headers:headers(token),body:JSON.stringify(input)}),context);
 expect(reserved.status).toBe(200);const {assetId,reservationId,uploadUrl}=await reserved.json();
 const replay=await reserve(new Request(`${origin}/api/video/projects/${projectId}/assets/reserve`,{method:'POST',headers:headers(token),body:JSON.stringify(input)}),context);
 expect((await replay.json()).assetId).toBe(assetId);
 const fileContext={params:Promise.resolve({projectId,assetId})};
 const bytes=Buffer.from('# 真实内容\n活动日期：10月8日');
 const unauthorized=await upload(new Request(`${origin}${uploadUrl}`,{method:'PUT',headers:headers(foreign,'text/markdown'),body:bytes,duplex:'half'} as RequestInit),fileContext);
 expect(unauthorized.status).toBe(404);
 const wrote=await upload(new Request(`${origin}${uploadUrl}`,{method:'PUT',headers:headers(token,'text/markdown'),body:bytes,duplex:'half'} as RequestInit),fileContext);
 expect(wrote.status).toBe(200);
 const finish=()=>complete(new Request(`${origin}/api/video/projects/${projectId}/assets/${assetId}/complete`,{method:'POST',headers:headers(token),body:JSON.stringify({schemaVersion:5,clientCommandId:crypto.randomUUID(),reservationId})}),fileContext);
 expect((await finish()).status).toBe(202);expect((await finish()).status).toBe(202);
 const view=await new ProjectStore(new FileStore(root)).view(ownerHash(sid,keys),projectId);
 expect(view.assets).toMatchObject([{id:assetId,status:'uploaded'}]);
});
it('a missing upload fails visibly and releases the pending state',async()=>{
 const sid='3'.repeat(64),token=issueSession(keys,Date.now(),sid).token;
 const {projectId}=await new ProjectStore(new FileStore(root)).create(ownerHash(sid,keys),{schemaVersion:5,clientCommandId:crypto.randomUUID(),clientCreateId:crypto.randomUUID()});
 const input={schemaVersion:5,clientCommandId:crypto.randomUUID(),filename:'资料.pdf',declaredBytes:100,declaredMime:'application/pdf',intendedUse:'reference',rightsConfirmed:true};
 const reserved=await reserve(new Request(`${origin}/api/video/projects/${projectId}/assets/reserve`,{method:'POST',headers:headers(token),body:JSON.stringify(input)}),{params:Promise.resolve({projectId})});
 const {assetId,reservationId}=await reserved.json();
 const failed=await complete(new Request(`${origin}/api/video/projects/${projectId}/assets/${assetId}/complete`,{method:'POST',headers:headers(token),body:JSON.stringify({schemaVersion:5,clientCommandId:crypto.randomUUID(),reservationId})}),{params:Promise.resolve({projectId,assetId})});
 expect(failed.status).toBe(400);
 const view=await new ProjectStore(new FileStore(root)).view(ownerHash(sid,keys),projectId);
 expect(view.assets).toMatchObject([{id:assetId,status:'failed',errorCode:'ASSET_INVALID'}]);
 expect((await new FileStore(root).readFresh<{inputPending:boolean}>(`projects/${projectId}/control`)).value.inputPending).toBe(false);
});
