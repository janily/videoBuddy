import {afterEach,beforeEach,expect,it} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {FileStore} from './helpers/file-store';
import {ProjectStore} from '@/services/video/storage/project-store';
import {AnalyticsEventSchema} from '@/services/video/analytics/events';
import {recordAnalyticsEvent,readAnalyticsDashboard,summarizeEvents} from '@/services/video/analytics/store';
import {recordStepTiming,readStepTimings} from '@/services/video/quick/timings';
import {userErrorMessage} from '@/services/video/http/user-messages';
let dir:string;
beforeEach(async()=>{dir=await mkdtemp(`${tmpdir()}/vb-metrics-`)});
afterEach(async()=>{await rm(dir,{recursive:true,force:true})});
it('rejects arbitrary telemetry text, unknown styles, and extra payload fields',()=>{
 expect(AnalyticsEventSchema.safeParse({name:'quick_reply_clicked',payload:{label:'private name'}}).success).toBe(false);
 expect(AnalyticsEventSchema.safeParse({name:'quick_reply_clicked',payload:{index:0,labelLength:4}}).success).toBe(true);
 expect(AnalyticsEventSchema.safeParse({name:'style_selected',payload:{id:'unknown-style',fromRecommend:true}}).success).toBe(false);
 expect(AnalyticsEventSchema.safeParse({name:'result_downloaded',payload:{text:'private'}}).success).toBe(false);
});
it('durably stores idempotent owner-scoped events without exposing other projects',async()=>{
 const projects=new ProjectStore(new FileStore(dir));
 const {projectId}=await projects.create('owner-a',{schemaVersion:5,clientCreateId:crypto.randomUUID(),clientCommandId:crypto.randomUUID()});
 const event={eventId:crypto.randomUUID(),projectId,name:'generate_clicked' as const,payload:{stage:'S3' as const}};
 await recordAnalyticsEvent(projects,'owner-a',event);
 await recordAnalyticsEvent(projects,'owner-a',event);
 await expect(recordAnalyticsEvent(projects,'owner-b',{...event,eventId:crypto.randomUUID()})).rejects.toThrow('ACCESS_NOT_FOUND');
 const dashboard=await readAnalyticsDashboard(new ProjectStore(new FileStore(dir)),'owner-a');
 expect(dashboard.eventCounts.generate_clicked).toBe(1);
 expect((await readAnalyticsDashboard(projects,'owner-b')).eventCount).toBe(0);
 await projects.tombstone('owner-a',projectId);
 expect((await readAnalyticsDashboard(projects,'owner-a')).eventCount).toBe(0);
});
it('counts style adoption and uses observed result timing without inventing churn',()=>{
 const base={projectId:crypto.randomUUID(),receivedAt:'2026-10-10T00:00:00.000Z'};
 const result=summarizeEvents([
  {...base,eventId:crypto.randomUUID(),name:'style_selected',payload:{id:'watercolor',fromRecommend:true}},
  {...base,eventId:crypto.randomUUID(),name:'style_selected',payload:{id:'watercolor',fromRecommend:false}},
  {...base,eventId:crypto.randomUUID(),name:'result_ready',payload:{ms:120000}},
 ]);
 expect(result.recommendationAdoptionRate).toBe(.5);
 expect(result.medianResultReadyMs).toBe(120000);
 expect(result.generationAbandonmentRate).toBeNull();
});
it('keeps the last 20 per-step actual timings and computes the even median',async()=>{
 const store=new FileStore(dir),projectId=crypto.randomUUID();
 for(let i=1;i<=22;i++)await recordStepTiming(store,projectId,'visual',i*100);
 const stats=await readStepTimings(store,projectId);
 expect(stats.visual).toEqual({samples:20,medianMs:1250});
 expect(stats.picture).toBeUndefined();
 await expect(recordStepTiming(store,projectId,'visual',NaN)).rejects.toThrow('VALIDATION_FAILED');
});
it('maps pipeline errors and never reveals an unknown raw error',()=>{
 expect(userErrorMessage('PICTURE_RENDER_FAILED: secret')).toContain('保留');
 expect(userErrorMessage('PICTURE_RENDER_FAILED')).toContain('重试');
 expect(userErrorMessage('secret-token')).not.toContain('secret-token');
});
it('the HTTP endpoint requires same-origin signed ownership and rejects free text',async()=>{
 const {POST,GET}=await import('@/app/api/video/analytics/route');
 const {issueSession,ownerHash}=await import('@/services/video/access/session');
 const {vi}=await import('vitest');
 const keys={current:'a'.repeat(32),keyId:'v1',environment:'metrics-test'},sid='b'.repeat(64);
 vi.stubEnv('VIDEO_DATA_DIR',dir);vi.stubEnv('VIDEO_SESSION_SIGNING_KEY',keys.current);vi.stubEnv('VIDEO_ENVIRONMENT',keys.environment);vi.stubEnv('VIDEO_APP_ORIGIN','https://video.test');
 try{
  const owner=ownerHash(sid,keys),projects=new ProjectStore(new FileStore(dir));
  const {projectId}=await projects.create(owner,{schemaVersion:5,clientCreateId:crypto.randomUUID(),clientCommandId:crypto.randomUUID()});
  const cookie=`vb-session=${issueSession(keys,Date.now(),sid).token}`;
  const input={projectId,eventId:crypto.randomUUID(),event:{name:'result_downloaded',payload:{}}};
  const request=(value:unknown,origin='https://video.test')=>new Request('https://video.test/api/video/analytics',{method:'POST',headers:{cookie,origin,'Content-Type':'application/json'},body:JSON.stringify(value)});
  expect((await POST(request(input,'https://evil.test'))).status).toBe(403);
  expect((await POST(request({...input,event:{name:'quick_reply_clicked',payload:{label:'My private message'}}}))).status).toBe(400);
  expect((await POST(request(input))).status).toBe(201);
  expect((await GET(new Request('https://video.test/api/video/analytics'))).status).toBe(404);
  const response=await GET(new Request('https://video.test/api/video/analytics',{headers:{cookie}}));
  expect(response.headers.get('Cache-Control')).toBe('private, no-store');
  expect((await response.json()).eventCounts.result_downloaded).toBe(1);
 }finally{vi.unstubAllEnvs()}
});
