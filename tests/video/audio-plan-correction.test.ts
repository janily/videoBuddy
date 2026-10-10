import {it,expect,vi} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {createServer} from 'node:http';
import {FileStore} from '@/services/video/storage/file-store';
import {ProjectStore} from '@/services/video/storage/project-store';
import {updateJson} from '@/services/video/storage/atomic-store';
import type {ProjectControl} from '@/contracts/video/project';
import type {FilmSpec} from '@/contracts/video/film';
import type {AudioPlan} from '@/contracts/video/audio-plan';
import {seedPreviewBundle,seedPreviewOperation} from './fixtures/preview-package';
const {clock}=vi.hoisted(()=>({clock:vi.fn()}));
vi.mock('@/services/video/preview/timing-stage',()=>({prepareTimingStage:clock}));
import {cancelProduction} from '@/services/video/commands/cancel';
const {marks}=vi.hoisted(()=>({marks:{count:0,after:undefined as ((count:number)=>Promise<void>)|undefined}}));
vi.mock('@/services/video/budget/model-call',async()=>{
 const actual=await vi.importActual<typeof import('@/services/video/budget/model-call')>('@/services/video/budget/model-call');
 return{...actual,markModelCallStarted:async()=>{await actual.markModelCallStarted();marks.count++;await marks.after?.(marks.count)}};
});
import {prepareAudioPlanStage} from '@/services/video/preview/audio-plan-stage';

// Local HTTP provider fixtures exercise real adapter/accounting and persisted
// stage recovery. No paid provider, native audio or listening evidence.
it.each(['corrected','exhausted','transport','full','revoked'] as const)('bounds known audio-parameter correction, accounting and recovery: %s',async scenario=>{
 marks.count=0;marks.after=undefined;
 const root=await mkdtemp(join(tmpdir(),'vb-audio-correction-')),projects=new ProjectStore(new FileStore(root)),{projectId}=await projects.create('owner',{schemaVersion:5,clientCommandId:randomUUID(),clientCreateId:randomUUID()}),operationId=randomUUID();
 const bundle=await seedPreviewBundle(projects,{projectId,briefVersion:1,durationSec:20,musicMode:'composed',previewArtifactSha256:'a'.repeat(64)}),spec=(await projects.store.readFresh<FilmSpec>(bundle.filmSpecRef.key)).value,treatment=(await projects.store.readFresh<{planRef:FilmSpec['treatmentRef']}>(spec.treatmentRef.key)).value,manifest=(await projects.store.readFresh<{planRef:FilmSpec['treatmentRef'];timingDraftRef:FilmSpec['treatmentRef']}>(spec.audioManifestRef.key)).value,template=(await projects.store.readFresh<AudioPlan>(manifest.planRef.key)).value;
 // Explicit composed intent keeps this test on the real model adapter path;
 // the fixture's default silent plan would correctly skip that call entirely.
 const valid:AudioPlan={...template,
  cues:[{id:'music-start',sourceShotId:'shot',requestedTimeUs:0,alignmentPolicy:'audio'}],
  sources:[{id:'fixture-tone',kind:'synthesis',description:'Local correction fixture',material:'synthetic',recipe:{instrument:'sine',frequencyHz:220,attackMs:5,releaseMs:100}}],
  music:[{eventId:'fixture-note',cueId:'music-start',source:'fixture-tone',durationSamples:48000,gainDb:-20,pan:0}],
  intentionalSilenceRanges:[],reasoning:'Composed audio protocol fixture; no rendering or listening evidence is claimed.'};
 clock.mockResolvedValue({draftRef:manifest.timingDraftRef});await seedPreviewOperation(projects,operationId,bundle);await updateJson(projects.store,`projects/${projectId}/control`,(c:ProjectControl)=>({...c,phase:'preparing_preview' as const,briefVersion:1,activeProduction:operationId}));
 const requests:Record<string,unknown>[]=[];
 const server=createServer(async(req,res)=>{
  let body='';for await(const part of req)body+=part;requests.push(JSON.parse(body));
  if(scenario==='transport'){res.writeHead(500,{'content-type':'application/json'});res.end(JSON.stringify({error:{message:'fixture provider failure'}}));return}
  const output=scenario==='corrected'&&requests.length===2?valid:{...valid,cues:[{id:'unused',sourceShotId:'shot',requestedTimeUs:0,alignmentPolicy:'audio'}]};
  res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({id:'audio-correction-fixture',object:'chat.completion',created:1,model:'test-model',choices:[{index:0,message:{role:'assistant',content:JSON.stringify(output)},finish_reason:'stop'}],usage:{prompt_tokens:100,completion_tokens:200,total_tokens:300}}));
 });
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address();if(!address||typeof address==='string')throw Error('FIXTURE_SERVER_FAILED');
 const env={VIDEO_DELIVERY_PROFILE:scenario==='full'?'full':'mvp',VIDEO_GENERATION_ENABLED:'true',VIDEO_ENVIRONMENT:'test',VIDEO_APP_ORIGIN:'http://localhost:3000',VIDEO_SESSION_SIGNING_KEY:'x'.repeat(32),VIDEO_DATA_DIR:root,VIDEO_PROJECT_MAX_MODEL_CALLS:'5',VIDEO_PROJECT_MAX_INPUT_TOKENS:'500000',VIDEO_PROJECT_MAX_OUTPUT_TOKENS:'60000',VIDEO_PROJECT_MAX_TTS_CHARACTERS:'1000',VIDEO_PROJECT_MAX_MEDIA_SECONDS:'1000',VIDEO_DAILY_MAX_MODEL_CALLS:'10',VIDEO_DAILY_MAX_MEDIA_SECONDS:'1000',MODEL_PROVIDER:'openai-compatible',MODEL_BASE_URL:`http://127.0.0.1:${address.port}/v1`,MODEL_API_KEY:'local-fixture-only',VIDEO_DIRECTOR_MODEL:'test-model',VIDEO_AUDIO_MODEL:'test-model'};
 if(scenario==='revoked')marks.after=async count=>{if(count===2)await cancelProduction(projects.store,projectId,operationId)};
 const run=()=>prepareAudioPlanStage(projects,projectId,bundle.revisionId,operationId,0,treatment.planRef,{root,env});
 try{
  if(scenario==='corrected'){const saved=await run();expect(await run()).toEqual(saved);expect(requests).toHaveLength(2);expect(JSON.stringify(requests[1])).toContain('previousPlan');expect(JSON.stringify(requests[1])).toContain('AUDIO_EVENT_INVALID')}
  else{await expect(run()).rejects.toThrow(scenario==='transport'?'MODEL_USAGE_INVALID':scenario==='revoked'?'PREVIEW_STALE':'AUDIO_EVENT_INVALID');expect(requests).toHaveLength(scenario==='exhausted'?2:1);await expect(run()).rejects.toThrow(scenario==='revoked'?'PREVIEW_STALE':'EFFECT_UNKNOWN');expect(requests).toHaveLength(scenario==='exhausted'?2:1)}
  const budget=(await projects.store.readFresh<{accounting:Record<string,{state:string;inputTokens?:number;outputTokens?:number}>}>(`projects/${projectId}/budget`)).value,usage=Object.values(budget.accounting);
  expect(usage).toHaveLength(scenario==='revoked'?2:requests.length);
  if(scenario==='revoked'){expect(usage.map(item=>item.state).sort()).toEqual(['settled','unknown'])}
  else if(scenario==='transport')expect(usage[0].state).toBe('unknown');else expect(usage.every(item=>item.state==='settled'&&item.inputTokens===100&&item.outputTokens===200)).toBe(true);
  const rejected=await new FileStore(root).listKeys(`projects/${projectId}/revisions/${bundle.revisionId}/audio-rejected`,1);expect(rejected.length).toBe(scenario==='corrected'||scenario==='exhausted'||scenario==='revoked'?1:0);
 }finally{marks.after=undefined;await new Promise<void>(resolve=>server.close(()=>resolve()));await rm(root,{recursive:true,force:true})}
});
