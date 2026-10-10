import {afterEach,describe,expect,it} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {FileStore} from '@/services/video/storage/file-store';
import {ProjectStore} from '@/services/video/storage/project-store';
import {LocalOperationQueue} from '@/services/video/commands/local-queue';
import {LocalEventLog} from '@/services/video/stream/local-event-log';
import {scheduleScriptDraft,runScriptOperation,readScriptView,quickTreatmentContext,readOrCreateTreatment} from '@/services/video/quick/script';
import {updateJson} from '@/services/video/storage/atomic-store';
import type {ProjectControl} from '@/contracts/video/project';
import type {TreatmentPlan} from '@/contracts/video/treatment';

const roots:string[]=[];
afterEach(async()=>{await Promise.all(roots.splice(0).map(root=>rm(root,{recursive:true,force:true})))});
async function setup(){const root=await mkdtemp(join(tmpdir(),'vb-script-'));roots.push(root);const store=new FileStore(root),projects=new ProjectStore(store),queue=new LocalOperationQueue(store,root),events=new LocalEventLog(root);const {projectId}=await projects.create('owner',{schemaVersion:5,clientCommandId:randomUUID(),clientCreateId:randomUUID(),preferences:{durationSec:20,styleSlug:'watercolor'}});let control=await projects.access('owner',projectId);const understanding={...(await store.readFresh<Record<string,unknown>>(control.understandingRef.key)).value,subject:'一杯咖啡',audience:'邻居',objective:'来店里坐坐'};const ref=await projects.index.immutable(`projects/${projectId}/understanding/test`,understanding);control=await updateJson(store,`projects/${projectId}/control`,(c:ProjectControl)=>({...c,understandingRef:ref}));return{root,store,projects,queue,events,projectId,control}}
function treatment(context:Awaited<ReturnType<typeof quickTreatmentContext>>):TreatmentPlan{return{schemaVersion:1,briefVersion:context.understanding.briefVersion,styleSlug:'watercolor',styleRulesHash:context.knowledge.sha256,durationSec:20,aspect:'16:9',fps:24,summary:'咖啡店的一天',options:['a','b','c'].map(id=>({id,concept:id,visualApproach:'温暖',soundApproach:'无',tradeoff:'简洁'})),selectedOptionId:'a',selectionReason:'适合邻里',shots:[{id:'shot-1',startFrame:0,endFrame:480,scriptLine:'欢迎来喝咖啡',visualIntent:'一杯咖啡',factIds:[]}],script:['欢迎来喝咖啡']}}
describe('script first durable scheduling',()=>{
 it('debounces a version once and persists across queue recreation',async()=>{const s=await setup();const first=await scheduleScriptDraft(s.projects,s.queue,s.projectId,{env:{VIDEO_FLOW:'quick'},now:1000});const next=await scheduleScriptDraft(s.projects,s.queue,s.projectId,{env:{VIDEO_FLOW:'quick'},now:2000});expect(next?.id).toBe(first?.id);expect(first?.notBefore).toBe(4000);expect((await new LocalOperationQueue(s.store,s.root).pending()).map(j=>j.kind)).toEqual(['script']);let calls=0;await runScriptOperation(s.projects,s.events,s.projectId,first!.id,{env:{VIDEO_FLOW:'quick'},now:3999,generate:async c=>{calls++;return treatment(c)}});expect(calls).toBe(0);await runScriptOperation(s.projects,s.events,s.projectId,first!.id,{env:{VIDEO_FLOW:'quick'},now:4000,generate:async c=>{calls++;return treatment(c)}});expect(calls).toBe(1);const control=await s.projects.access('owner',s.projectId);expect((await readScriptView(s.projects,control))?.state).toBe('ready');const messages=await s.projects.messages(control);expect(messages).toHaveLength(1);expect(messages[0].text).toContain('咖啡店的一天');const events=await s.events.readFrom(s.projectId,first!.id,0);expect(events.findIndex(e=>e.event.type==='message.committed')).toBeLessThan(events.findIndex(e=>e.event.type==='script.ready'));const context=await quickTreatmentContext(s.projects,control);await readOrCreateTreatment(s.projects,context,async()=>{throw Error('must reuse script')});expect((await s.projects.view('owner',s.projectId)).understanding.audience).toBe('邻居')});
 it('fences a late draft when the brief changes, retaining it as stale',async()=>{const s=await setup(),op=await scheduleScriptDraft(s.projects,s.queue,s.projectId,{env:{VIDEO_FLOW:'quick'},now:0});await runScriptOperation(s.projects,s.events,s.projectId,op!.id,{env:{VIDEO_FLOW:'quick'},now:4000,generate:async c=>{await updateJson(s.store,`projects/${s.projectId}/control`,(control:ProjectControl)=>({...control,briefVersion:control.briefVersion+1}));return treatment(c)}});const control=await s.projects.access('owner',s.projectId);expect((await readScriptView(s.projects,control))?.state).toBe('stale');expect((await s.store.readFresh<{status:string}>(`projects/${s.projectId}/operations/${op!.id}`)).value.status).toBe('superseded')});
 it('retains the last completed storyboard through two queued brief revisions',async()=>{
  const s=await setup(),env={VIDEO_FLOW:'quick'},first=await scheduleScriptDraft(s.projects,s.queue,s.projectId,{env,now:0});
  await runScriptOperation(s.projects,s.events,s.projectId,first!.id,{now:4000,generate:async c=>treatment(c)});
  for(const version of [1,2]){
   const current=await s.projects.access('owner',s.projectId),u=(await s.store.readFresh<Record<string,unknown>>(current.understandingRef.key)).value;
   const ref=await s.projects.index.immutable(`projects/${s.projectId}/understanding/revision-${version}`,{...u,briefVersion:version,subject:`咖啡店 ${version}`});
   await updateJson(s.store,`projects/${s.projectId}/control`,(c:ProjectControl)=>({...c,briefVersion:version,understandingRef:ref}));
   await scheduleScriptDraft(s.projects,s.queue,s.projectId,{env,now:5000+version});
  }
  const control=await s.projects.access('owner',s.projectId),view=await readScriptView(s.projects,control);
  expect(view?.state).toBe('stale');expect(view?.briefVersion).toBe(0);expect(view?.shots[0].scriptLine).toBe('欢迎来喝咖啡');
 });
 it('isolates failure, supports explicit retry, and leaves staged flow untouched',async()=>{const s=await setup();expect(await scheduleScriptDraft(s.projects,s.queue,s.projectId,{env:{VIDEO_FLOW:'staged'}})).toBeNull();const op=await scheduleScriptDraft(s.projects,s.queue,s.projectId,{env:{VIDEO_FLOW:'quick'},now:0});await runScriptOperation(s.projects,s.events,s.projectId,op!.id,{now:4000,generate:async()=>{throw Error('provider secret')}});let control=await s.projects.access('owner',s.projectId);expect((await readScriptView(s.projects,control))?.state).toBe('failed');expect((await readScriptView(s.projects,control))?.errorMessage).not.toContain('secret');expect(await scheduleScriptDraft(s.projects,s.queue,s.projectId,{env:{VIDEO_FLOW:'quick'},now:5000})).toBeNull();const retry=await scheduleScriptDraft(s.projects,s.queue,s.projectId,{env:{VIDEO_FLOW:'quick'},retry:true,now:5000});expect(retry?.id).not.toBe(op!.id);control=await s.projects.access('owner',s.projectId);expect(control.activeProduction).toBeUndefined()});
});
