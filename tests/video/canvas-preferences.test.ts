import {beforeEach,afterEach,it,expect,vi} from 'vitest';
import {randomUUID} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {FileStore} from './helpers/file-store';
import {ProjectStore} from '@/services/video/storage/project-store';
import {updateJson,type AtomicStore} from '@/services/video/storage/atomic-store';
import type {ProjectControl} from '@/contracts/video/project';
import type {Understanding} from '@/contracts/video/domain';
import {budgetKeys} from '@/services/video/config/environment';
import {CanvasPreferencesRequestSchema,updateCanvasPreferences} from '@/services/video/commands/canvas-preferences';
let dir:string,projects:ProjectStore,projectId:string;
const owner='owner';
const input=(patch:{durationSec?:20|25|30;aspect?:'16:9'|'9:16';styleSlug?:string|null}={durationSec:25})=>({schemaVersion:5 as const,clientCommandId:randomUUID(),expectedBriefVersion:0,patch});
const control=()=>projects.access(owner,projectId);
const understanding=async()=>((await projects.store.readFresh<Understanding>((await control()).understandingRef.key)).value);
beforeEach(async()=>{dir=await mkdtemp(`${tmpdir()}/vb-canvas-preferences-`);projects=new ProjectStore(new FileStore(dir));({projectId}=await projects.create(owner,{schemaVersion:5,clientCreateId:randomUUID(),clientCommandId:randomUUID()}))});
afterEach(async()=>{vi.unstubAllEnvs();await rm(dir,{recursive:true,force:true})});
it('commits preference changes and both conversation messages together without admitting production',async()=>{
 await updateCanvasPreferences(projects,owner,projectId,input({durationSec:25,aspect:'9:16'}));
 const c=await control(),u=await understanding(),messages=await projects.messages(c);
 expect(c.briefVersion).toBe(1);expect(u.briefVersion).toBe(1);expect(u.preferences).toMatchObject({durationSec:25,aspect:'9:16'});
 expect(messages).toHaveLength(2);expect(messages[0]).toMatchObject({role:'user',origin:'canvas',ordinal:1});expect(messages[0].text).toContain('25 秒');
 expect(messages[1]).toMatchObject({role:'assistant',ordinal:2});expect(u.sourceMessageIds).toContain(messages[0].id);
 expect(c.activeProduction).toBeFalsy();expect(c.activeConversation).toBeFalsy();
});
it('replays concurrent and cold duplicate commands once, even after the brief has advanced',async()=>{
 const request=input();await Promise.all([updateCanvasPreferences(projects,owner,projectId,request),updateCanvasPreferences(projects,owner,projectId,request)]);
 await updateCanvasPreferences(projects,owner,projectId,{...input({aspect:'9:16'}),expectedBriefVersion:1});
 projects=new ProjectStore(new FileStore(dir));await updateCanvasPreferences(projects,owner,projectId,request);
 expect((await control()).briefVersion).toBe(2);expect(await projects.messages(await control())).toHaveLength(4);
 await expect(updateCanvasPreferences(projects,owner,projectId,{...request,patch:{durationSec:30}})).rejects.toThrow('IDEMPOTENCY_CONFLICT');
});
it('admits only one of two conflicting edits to the same brief version',async()=>{
 const results=await Promise.allSettled([updateCanvasPreferences(projects,owner,projectId,input({durationSec:20})),updateCanvasPreferences(projects,owner,projectId,input({durationSec:25}))]);
 expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);expect(results.find(r=>r.status==='rejected')).toMatchObject({reason:{message:'BRIEF_CONFLICT'}});
 expect((await control()).briefVersion).toBe(1);expect(await projects.messages(await control())).toHaveLength(2);
});
it('keeps the brief version and immutable understanding for a no-op',async()=>{
 const c=await control(),u=await understanding();await updateCanvasPreferences(projects,owner,projectId,input({aspect:u.preferences.aspect}));
 expect((await control()).briefVersion).toBe(0);expect((await control()).understandingRef).toEqual(c.understandingRef);expect(await projects.messages(await control())).toHaveLength(2);
});
it.each(['activeProduction','activeConversation'] as const)('rejects %s before changing preferences or conversation',async lane=>{
 await updateJson(projects.store,`projects/${projectId}/control`,(c:ProjectControl)=>({...c,[lane]:randomUUID()}));
 await expect(updateCanvasPreferences(projects,owner,projectId,input())).rejects.toThrow('BUSY');
 expect((await control()).briefVersion).toBe(0);expect(await projects.messages(await control())).toHaveLength(0);
});
it('rejects another owner and expired projects',async()=>{
 await expect(updateCanvasPreferences(projects,'stranger',projectId,input())).rejects.toThrow('ACCESS_NOT_FOUND');
 await updateJson(projects.store,`projects/${projectId}/control`,(c:ProjectControl)=>({...c,expiresAt:'2000-01-01T00:00:00.000Z'}));
 await expect(updateCanvasPreferences(projects,owner,projectId,input())).rejects.toThrow('PROJECT_EXPIRED');
});
it('recovers a failure before the control CAS without exposing partial messages or a partial preference update',async()=>{
 const backing=projects.store;let fail=true;
 const interrupted:AtomicStore={readFresh:backing.readFresh.bind(backing),create:backing.create.bind(backing),cas:async(key,etag,value)=>{if(fail&&key===`projects/${projectId}/control`){fail=false;throw Error('simulated crash')}return backing.cas(key,etag,value)}};
 const request=input();await expect(updateCanvasPreferences(new ProjectStore(interrupted),owner,projectId,request)).rejects.toThrow('simulated crash');
 expect((await control()).briefVersion).toBe(0);expect(await projects.messages(await control())).toHaveLength(0);
 await updateCanvasPreferences(projects,owner,projectId,request);expect((await control()).briefVersion).toBe(1);expect(await projects.messages(await control())).toHaveLength(2);
});
it('rechecks active production after losing a control CAS race',async()=>{
 const backing=projects.store;let race=true;
 const racing:AtomicStore={readFresh:backing.readFresh.bind(backing),create:backing.create.bind(backing),cas:async(key,etag,value)=>{if(race&&key===`projects/${projectId}/control`){race=false;await updateJson(backing,key,(c:ProjectControl)=>({...c,activeProduction:randomUUID(),controlVersion:c.controlVersion+1}))}return backing.cas(key,etag,value)}};
 await expect(updateCanvasPreferences(new ProjectStore(racing),owner,projectId,input())).rejects.toThrow('BUSY');
 expect((await control()).briefVersion).toBe(0);expect(await projects.messages(await control())).toHaveLength(0);
});
it.each([{}, {durationSec:21},{durationSec:45},{aspect:'1:1'},{styleSlug:'ink'},{durationSec:25,language:'en'}])('limits direct changes to the supported nonempty preference patch %j',patch=>{
 expect(CanvasPreferencesRequestSchema.safeParse({...input(),patch}).success).toBe(false);
});
it('replays after a lost acknowledgement of a successful commit without duplicating messages',async()=>{
 const backing=projects.store;let fail=true;
 const interrupted:AtomicStore={readFresh:backing.readFresh.bind(backing),create:backing.create.bind(backing),cas:async(key,etag,value)=>{await backing.cas(key,etag,value);if(fail&&key===`projects/${projectId}/control`){fail=false;throw Error('lost acknowledgement')}}};
 const request=input();await expect(updateCanvasPreferences(new ProjectStore(interrupted),owner,projectId,request)).rejects.toThrow('lost acknowledgement');
 await updateCanvasPreferences(new ProjectStore(new FileStore(dir)),owner,projectId,request);
 expect((await control()).briefVersion).toBe(1);expect(await projects.messages(await control())).toHaveLength(2);
});

it('keeps regeneration enabled and the finished video visible after changing its specifications',async()=>{
 for(const [key,value] of Object.entries({VIDEO_FLOW:'quick',VIDEO_DELIVERY_PROFILE:'mvp',VIDEO_GENERATION_ENABLED:'true',VIDEO_ENVIRONMENT:'test',VIDEO_APP_ORIGIN:'https://video.test',VIDEO_SESSION_SIGNING_KEY:'a'.repeat(64),VIDEO_DATA_DIR:dir,MODEL_API_KEY:'local-fixture-only',VIDEO_DIRECTOR_MODEL:'local-fixture',VIDEO_MODEL_BUDGET_MODE:'bounded'}))vi.stubEnv(key,value);
 for(const key of budgetKeys)vi.stubEnv(key,'100000');
 const previous=await understanding(),ref=await projects.index.immutable(`projects/${projectId}/understanding/completed-fixture`,{...previous,subject:'咖啡店介绍',preferences:{...previous.preferences,durationSec:20,styleSlug:'watercolor'}});
 const resultId=randomUUID(),artifactId=randomUUID();
 // Manifest-only fixture: the view reads publication metadata, never media bytes.
 await projects.store.create(`projects/${projectId}/results/${resultId}/manifest`,{kind:'quick',resultId,artifactId,revisionId:randomUUID(),operationId:randomUUID(),bundleHash:'a'.repeat(64),mp4Sha256:'b'.repeat(64),mp4Bytes:1,briefVersion:0,styleSlug:'watercolor',aspect:'16:9',durationSec:20,shots:[{id:'shot-1',scriptLine:'欢迎来喝咖啡',startFrame:0,endFrame:480,take:0}],music:null,aiLabel:true,createdAt:new Date().toISOString()});
 await updateJson(projects.store,`projects/${projectId}/control`,(c:ProjectControl)=>({...c,understandingRef:ref,currentResultId:resultId,phase:'ready' as const}));
 const before=await projects.view(owner,projectId);
 expect(before.actions.find(action=>action.kind==='generate_video')).toMatchObject({enabled:true});
 await updateCanvasPreferences(projects,owner,projectId,input({durationSec:25,aspect:'9:16'}));
 const view=await projects.view(owner,projectId);
 expect(view.actions.find(action=>action.kind==='generate_video')).toMatchObject({enabled:true});
 expect(view.phase).toBe('ready');expect(view.briefVersion).toBe(1);expect(view.preferences).toMatchObject({durationSec:25,aspect:'9:16'});
 expect(view.currentResult).toEqual(before.currentResult);expect(view.currentResult?.artifactId).toBe(artifactId);
 expect(view.activeProduction).toBeNull();
});

it('selects a known style and undoes to an unselected brief with durable assistant confirmation',async()=>{
 await updateCanvasPreferences(projects,owner,projectId,input({styleSlug:'ink-wash'}));
 expect((await understanding()).preferences.styleSlug).toBe('ink-wash');
 const undo={...input({styleSlug:null}),expectedBriefVersion:1};
 await updateCanvasPreferences(projects,owner,projectId,undo);
 await updateCanvasPreferences(projects,owner,projectId,undo);
 expect((await understanding()).preferences.styleSlug).toBeNull();
 expect((await control()).briefVersion).toBe(2);
 const messages=await projects.messages(await control());expect(messages).toHaveLength(4);expect(messages.at(-1)?.text).toContain('撤销画风选择');
});
