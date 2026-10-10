import {it,expect,beforeEach,afterEach,vi} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {FileStore} from '@/services/video/storage/file-store';
import {ProjectStore} from '@/services/video/storage/project-store';
import {updateJson} from '@/services/video/storage/atomic-store';
import type {ProjectControl} from '@/contracts/video/project';
import {issueSession,ownerHash} from '@/services/video/access/session';
import {POST} from '@/app/api/video/projects/[projectId]/quick/route';
import {quickResultKey} from '@/services/video/results/publish-film';
import {readQuickSettings} from '@/services/video/quick/settings';
let root:string;
const origin='https://video.test',sid='1'.repeat(64),keys={current:'a'.repeat(64),keyId:'v1',environment:'test'};
beforeEach(async()=>{root=await mkdtemp(`${tmpdir()}/vb-canvas-music-`);for(const [k,v] of Object.entries({VIDEO_DATA_DIR:root,VIDEO_APP_ORIGIN:origin,VIDEO_SESSION_SIGNING_KEY:keys.current,VIDEO_SESSION_KEY_ID:keys.keyId,VIDEO_ENVIRONMENT:keys.environment,VIDEO_FLOW:'quick'}))vi.stubEnv(k,v)});
afterEach(async()=>{vi.restoreAllMocks();vi.unstubAllEnvs();await rm(root,{recursive:true,force:true})});
async function fixture(){
 const projects=new ProjectStore(new FileStore(root)),owner=ownerHash(sid,keys),{projectId}=await projects.create(owner,{schemaVersion:5,clientCommandId:crypto.randomUUID(),clientCreateId:crypto.randomUUID()});
 const send=(value:unknown)=>POST(new Request(`${origin}/api/video/projects/${projectId}/quick`,{method:'POST',headers:{origin,'Content-Type':'application/json',cookie:`vb-session=${issueSession(keys,Date.now(),sid).token}`},body:JSON.stringify(value)}),{params:Promise.resolve({projectId})});
 return{projects,owner,projectId,send};
}
it('records canvas music with a concise reply and replays once without undoing a newer choice',async()=>{
 const {projects,owner,projectId,send}=await fixture();
 const command={schemaVersion:5,clientCommandId:crypto.randomUUID(),origin:'canvas',music:{mode:'off'}};
 const first=await send(command);expect(first.status).toBe(200);
 const firstView=await first.json();expect(firstView.quick.music).toEqual({mode:'off'});
 expect(firstView.messages).toEqual([expect.objectContaining({role:'user',text:'关闭配乐',origin:'canvas',ordinal:1}),expect.objectContaining({role:'assistant',text:'配乐已关闭，下次生成时生效。',ordinal:2})]);
 expect(firstView.activeConversation).toBeNull();expect(firstView.activeProduction).toBeNull();
 expect((await send(command)).status).toBe(200);
 expect((await send({...command,music:{mode:'auto'}})).status).toBe(409);
 expect((await send({...command,clientCommandId:crypto.randomUUID(),music:{mode:'auto'}})).status).toBe(200);
 expect((await send(command)).status).toBe(200);
 const view=await new ProjectStore(new FileStore(root)).view(owner,projectId);
 expect(view.messages).toHaveLength(4);expect(view.quick?.music).toEqual({mode:'auto'});
 expect((await projects.access(owner,projectId)).nextOrdinal).toBe(5);
});
it('blocks canvas and legacy music updates while a conversation owns the message ordinals',async()=>{
 const {projects,projectId,send}=await fixture();
 await updateJson(projects.store,`projects/${projectId}/control`,(c:ProjectControl)=>({...c,activeConversation:crypto.randomUUID()}));
 for(const metadata of [{},{origin:'canvas',clientCommandId:crypto.randomUUID()}])expect((await send({schemaVersion:5,music:{mode:'off'},...metadata})).status).toBe(409);
});
it('keeps legacy music payloads working and never creates a production operation',async()=>{
 const {send}=await fixture(),response=await send({schemaVersion:5,music:{mode:'off'}});
 expect(response.status).toBe(200);expect(await response.json()).toMatchObject({quick:{music:{mode:'off'}},activeProduction:null});
});
it('leaves a restarted client free to change music after a committed control acknowledgement is lost',async()=>{
 const {send,owner,projectId}=await fixture(),command={schemaVersion:5,clientCommandId:crypto.randomUUID(),origin:'canvas',music:{mode:'off'}};
 const cas=FileStore.prototype.cas;let lost=false;
 vi.spyOn(FileStore.prototype,'cas').mockImplementation(async function(this:FileStore,key,etag,value){await cas.call(this,key,etag,value);if(!lost&&key.endsWith('/control')){lost=true;throw Error('ACK_LOST')}});
 expect((await send(command)).status).toBeGreaterThanOrEqual(400);expect(lost).toBe(true);
 expect((await send({...command,clientCommandId:crypto.randomUUID(),music:{mode:'auto'}})).status).toBe(200);
 expect((await send(command)).status).toBe(200);
 const view=await new ProjectStore(new FileStore(root)).view(owner,projectId);
 expect(view.messages).toHaveLength(4);expect(view.quick?.music).toEqual({mode:'auto'});expect(view.activeConversation).toBeNull();
});
it('deduplicates concurrent retries of the same canvas message',async()=>{
 const {send,owner,projectId}=await fixture(),command={schemaVersion:5,clientCommandId:crypto.randomUUID(),origin:'canvas',music:{mode:'off'}};
 const replies=await Promise.all([send(command),send(command)]);expect(replies.map(reply=>reply.status)).toEqual([200,200]);
 const view=await new ProjectStore(new FileStore(root)).view(owner,projectId);expect(view.messages).toHaveLength(2);expect(view.messages.map(message=>message.ordinal)).toEqual([1,2]);
});
it('archives a canvas shot redraw atomically and increments its take only once per command',async()=>{
 const {send,projects,owner,projectId}=await fixture(),resultId=crypto.randomUUID();
 await projects.store.create(quickResultKey(projectId,resultId),{kind:'quick',resultId,artifactId:crypto.randomUUID(),revisionId:crypto.randomUUID(),operationId:crypto.randomUUID(),bundleHash:'a'.repeat(64),mp4Sha256:'b'.repeat(64),mp4Bytes:12,briefVersion:0,styleSlug:'ink-wash',aspect:'16:9',durationSec:20,shots:[{id:'shot-1',scriptLine:'开场',startFrame:0,endFrame:480,take:0}],music:null,aiLabel:true,createdAt:new Date().toISOString()});
 await updateJson(projects.store,`projects/${projectId}/control`,(c:ProjectControl)=>({...c,currentResultId:resultId,phase:'ready' as const}));
 const command={schemaVersion:5,clientCommandId:crypto.randomUUID(),origin:'canvas',redoShotId:'shot-1'};
 expect((await send(command)).status).toBe(200);expect((await send(command)).status).toBe(200);
 expect((await readQuickSettings(projects.store,projectId)).takes).toEqual({'shot-1':1});
 const view=await projects.view(owner,projectId);expect(view.messages).toEqual([expect.objectContaining({role:'user',origin:'canvas',text:'重画第 1 镜'}),expect.objectContaining({role:'assistant',text:'已记下，下一次生成会重画第 1 镜。'})]);
 expect((await send({...command,clientCommandId:crypto.randomUUID()})).status).toBe(200);
 expect((await readQuickSettings(projects.store,projectId)).takes).toEqual({'shot-1':2});
 expect((await send({...command,clientCommandId:crypto.randomUUID(),redoShotId:'missing'})).status).toBe(409);
 expect((await projects.view(owner,projectId)).messages).toHaveLength(4);
 await updateJson(projects.store,`projects/${projectId}/control`,(c:ProjectControl)=>({...c,briefVersion:1}));
 expect((await send({...command,clientCommandId:crypto.randomUUID()})).status).toBe(409);
});
