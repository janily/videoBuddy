import {afterEach,describe,expect,it} from 'vitest';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {FileStore} from '@/services/video/storage/file-store';
import {ProjectStore} from '@/services/video/storage/project-store';
import {LocalEventLog} from '@/services/video/stream/local-event-log';
import {archiveAssistantMilestone,milestoneContent} from '@/services/video/quick/milestones';
import {runQuickFilmOperation} from '@/services/video/quick/operation';
import {createOrRead,updateJson} from '@/services/video/storage/atomic-store';
import type {ProjectControl} from '@/contracts/video/project';
import type {PreviewOperation} from '@/services/video/preview/prepare';
import type {QuickFilmOutput} from '@/services/video/quick/film';
const roots:string[]=[];afterEach(async()=>{await Promise.all(roots.splice(0).map(root=>rm(root,{recursive:true,force:true})))});
async function setup(){const root=await mkdtemp(join(tmpdir(),'vb-milestones-'));roots.push(root);const store=new FileStore(root),projects=new ProjectStore(store),events=new LocalEventLog(root);const{projectId}=await projects.create('owner',{schemaVersion:5,clientCommandId:randomUUID(),clientCreateId:randomUUID()});return{root,store,projects,events,projectId}}
async function prepare(s:Awaited<ReturnType<typeof setup>>){const operationId=randomUUID(),control=await s.projects.access('owner',s.projectId);const op:PreviewOperation={id:operationId,projectId:s.projectId,commandId:randomUUID(),kind:'preview',status:'reserved',canonicalRunId:null,streamEpoch:0,fence:0,revisionId:randomUUID(),previewId:randomUUID(),briefVersion:0,consentEpoch:0,understandingRef:control.understandingRef};await createOrRead(s.store,`projects/${s.projectId}/operations/${operationId}`,op);await updateJson(s.store,`projects/${s.projectId}/control`,(c:ProjectControl)=>({...c,activeProduction:operationId,phase:'preparing_preview' as const}));return operationId}
describe('durable assistant milestones',()=>{
 it('archives a sourced script summary exactly once, with valid references and reserved ordinal safety',async()=>{
  const s=await setup(),operationId=randomUUID();
  await updateJson(s.store,`projects/${s.projectId}/control`,(c:ProjectControl)=>({...c,nextOrdinal:7,ordinalReservations:{chat:{user:5,assistant:6}}}));
  const content=milestoneContent('script-ready','月亮升起，一家人围坐吃月饼');
  await Promise.all([archiveAssistantMilestone(s.projects,s.projectId,operationId,'script-ready',content),archiveAssistantMilestone(s.projects,s.projectId,operationId,'script-ready',content)]);
  await archiveAssistantMilestone(new ProjectStore(new FileStore(s.root)),s.projectId,operationId,'script-ready',content);
  const c=await s.projects.access('owner',s.projectId),messages=await s.projects.messages(c);
  expect(messages).toHaveLength(1);expect(messages[0].ordinal).toBe(7);expect(c.nextOrdinal).toBe(8);expect(c.ordinalReservations.chat).toEqual({user:5,assistant:6});
  expect(messages[0].text).toContain('月亮升起，一家人围坐吃月饼');expect(messages[0].ui?.canvasFocus).toBe('script');
  for(const ref of messages[0].ui?.canvasRefs||[])expect(messages[0].text).toContain(ref.text);
 });
 it('archives one start and one completion before ready events and cold replay never adds chat spam',async()=>{
  const s=await setup(),operationId=await prepare(s),bytes=Buffer.alloc(2048,23),outputPath=join(s.root,'film.mp4');await writeFile(outputPath,bytes);
  const film:QuickFilmOutput={outputPath,sha256:createHash('sha256').update(bytes).digest('hex'),bytes:bytes.length,width:1920,height:1080,durationSec:20,styleSlug:'watercolor',aspect:'16:9',briefVersion:0,shots:[{id:'shot-1',scriptLine:'月亮升起',startFrame:0,endFrame:480,take:0}],fps:24,music:null};
  await runQuickFilmOperation(s.store,s.events,s.projectId,operationId,{root:s.root,build:async()=>film});
  await runQuickFilmOperation(new FileStore(s.root),s.events,s.projectId,operationId,{root:s.root,build:async()=>{throw Error('must not rebuild')}});
  const messages=await s.projects.messages(await s.projects.access('owner',s.projectId));expect(messages).toHaveLength(2);expect(messages[0].text).toContain('开始生成');expect(messages[1].text).toContain('视频做好了');expect(messages[1].text).toContain('重画这一镜');
  const events=await s.events.readFrom(s.projectId,operationId,0),ready=events.findIndex(value=>value.event.type==='result.ready');
  expect(events.slice(0,ready).some(value=>value.event.type==='message.committed'&&value.event.payload.messageId===messages[1].id)).toBe(true);
  for(const message of messages)for(const ref of message.ui?.canvasRefs||[])expect(message.text).toContain(ref.text);
 });
 it('archives a failure with preserved-work and retry guidance without claiming completion',async()=>{
  const s=await setup(),operationId=await prepare(s);
  for(let replay=0;replay<2;replay++)await runQuickFilmOperation(s.store,s.events,s.projectId,operationId,{root:s.root,build:async()=>{throw Error('PICTURE_RENDER_FAILED: private provider text')}});
  const messages=await s.projects.messages(await s.projects.access('owner',s.projectId));expect(messages).toHaveLength(2);expect(messages[1].text).toContain('已保留');expect(messages[1].text).toContain('重试');expect(messages.some(message=>message.text.includes('视频做好了'))).toBe(false);expect(messages[1].text).not.toContain('provider');
  const events=await s.events.readFrom(s.projectId,operationId,0);expect(events.some(value=>value.event.type==='result.ready')).toBe(false);
 });
});
