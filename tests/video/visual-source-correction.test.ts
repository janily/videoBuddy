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
import type {VisualShotSource} from '@/contracts/video/visual-shot';
import {seedPreviewBundle,seedPreviewOperation} from './fixtures/preview-package';
const {clock}=vi.hoisted(()=>({clock:vi.fn()}));
vi.mock('@/services/video/preview/timing-stage',()=>({prepareTimingStage:clock}));
import {cancelProduction} from '@/services/video/commands/cancel';
const {marks}=vi.hoisted(()=>({marks:{count:0,after:undefined as ((count:number)=>Promise<void>)|undefined}}));
vi.mock('@/services/video/budget/model-call',async()=>{
 const actual=await vi.importActual<typeof import('@/services/video/budget/model-call')>('@/services/video/budget/model-call');
 return{...actual,markModelCallStarted:async()=>{await actual.markModelCallStarted();marks.count++;await marks.after?.(marks.count)}};
});
import {prepareVisualShotStage} from '@/services/video/preview/visual-stage';

// Local HTTP provider fixtures exercise real adapter/accounting and persisted
// stage recovery. No paid provider, native audio or listening evidence.
it.each(['corrected','exhausted','transport','full','revoked'] as const)('bounds known visual-source correction, accounting and recovery: %s',async scenario=>{
 marks.count=0;marks.after=undefined;
 const root=await mkdtemp(join(tmpdir(),'vb-visual-correction-')),projects=new ProjectStore(new FileStore(root)),{projectId}=await projects.create('owner',{schemaVersion:5,clientCommandId:randomUUID(),clientCreateId:randomUUID()}),operationId=randomUUID();
 const bundle=await seedPreviewBundle(projects,{projectId,briefVersion:1,durationSec:20,previewArtifactSha256:'a'.repeat(64)}),spec=(await projects.store.readFresh<FilmSpec>(bundle.filmSpecRef.key)).value,treatment=(await projects.store.readFresh<{planRef:FilmSpec['treatmentRef']}>(spec.treatmentRef.key)).value,manifest=(await projects.store.readFresh<{planRef:FilmSpec['treatmentRef'];timingDraftRef:FilmSpec['treatmentRef']}>(spec.audioManifestRef.key)).value,sources=(await projects.store.readFresh<{modules:Array<{sourceRef:FilmSpec['treatmentRef']}>}>(spec.sourceManifestRef.key)).value,code=(await projects.store.readFresh<{visualSourceRef:FilmSpec['treatmentRef']}>(sources.modules[0].sourceRef.key)).value,valid=(await projects.store.readFresh<VisualShotSource>(code.visualSourceRef.key)).value;
 clock.mockResolvedValue({draftRef:manifest.timingDraftRef});await seedPreviewOperation(projects,operationId,bundle);await updateJson(projects.store,`projects/${projectId}/control`,(c:ProjectControl)=>({...c,phase:'preparing_preview' as const,briefVersion:1,activeProduction:operationId}));
 const requests:Record<string,unknown>[]=[];
 const server=createServer(async(req,res)=>{
  let body='';for await(const part of req)body+=part;requests.push(JSON.parse(body));
  if(scenario==='transport'){res.writeHead(500,{'content-type':'application/json'});res.end(JSON.stringify({error:{message:'fixture provider failure'}}));return}
  const output=scenario==='corrected'&&requests.length===2?valid:{...valid,sourceHtml:'<!doctype html><html>'+ 'x'.repeat(200) +'</html>'};
  res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({id:'audio-correction-fixture',object:'chat.completion',created:1,model:'test-model',choices:[{index:0,message:{role:'assistant',content:scenario==='corrected'&&requests.length===1?'```json\n{"sourceHtml":"unterminated':JSON.stringify(output)},finish_reason:'stop'}],usage:{prompt_tokens:100,completion_tokens:200,total_tokens:300}}));
 });
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address();if(!address||typeof address==='string')throw Error('FIXTURE_SERVER_FAILED');
 const env={VIDEO_DELIVERY_PROFILE:scenario==='full'?'full':'mvp',VIDEO_GENERATION_ENABLED:'true',VIDEO_ENVIRONMENT:'test',VIDEO_APP_ORIGIN:'http://localhost:3000',VIDEO_SESSION_SIGNING_KEY:'x'.repeat(32),VIDEO_DATA_DIR:root,VIDEO_PROJECT_MAX_MODEL_CALLS:'5',VIDEO_PROJECT_MAX_INPUT_TOKENS:'500000',VIDEO_PROJECT_MAX_OUTPUT_TOKENS:'60000',VIDEO_PROJECT_MAX_TTS_CHARACTERS:'1000',VIDEO_PROJECT_MAX_MEDIA_SECONDS:'1000',VIDEO_DAILY_MAX_MODEL_CALLS:'10',VIDEO_DAILY_MAX_MEDIA_SECONDS:'1000',MODEL_PROVIDER:'openai-compatible',MODEL_BASE_URL:`http://127.0.0.1:${address.port}/v1`,MODEL_API_KEY:'local-fixture-only',VIDEO_DIRECTOR_MODEL:'test-model',VIDEO_VISUAL_MODEL:'test-model'};
 if(scenario==='revoked')marks.after=async count=>{if(count===2)await cancelProduction(projects.store,projectId,operationId)};
 const run=()=>prepareVisualShotStage(projects,projectId,bundle.revisionId,operationId,0,treatment.planRef,'shot',{root,env});
 try{
  if(scenario==='corrected'){const saved=await run();expect(await run()).toEqual(saved);expect(requests).toHaveLength(2);expect(JSON.stringify(requests[1])).toContain('previousSource');expect(JSON.stringify(requests[1])).toContain('VISUAL_SOURCE_INVALID')}
  else{await expect(run()).rejects.toThrow(scenario==='transport'?'MODEL_USAGE_INVALID':scenario==='revoked'?'PREVIEW_STALE':'VISUAL_SOURCE_INVALID');expect(requests).toHaveLength(scenario==='exhausted'?2:1);await expect(run()).rejects.toThrow(scenario==='revoked'?'PREVIEW_STALE':'EFFECT_UNKNOWN');expect(requests).toHaveLength(scenario==='exhausted'?2:1)}
  const budget=(await projects.store.readFresh<{accounting:Record<string,{state:string;inputTokens?:number;outputTokens?:number}>}>(`projects/${projectId}/budget`)).value,usage=Object.values(budget.accounting);
  expect(usage).toHaveLength(scenario==='revoked'?2:requests.length);
  if(scenario==='revoked'){expect(usage.map(item=>item.state).sort()).toEqual(['settled','unknown'])}
  else if(scenario==='transport')expect(usage[0].state).toBe('unknown');else expect(usage.every(item=>item.state==='settled'&&item.inputTokens===100&&item.outputTokens===200)).toBe(true);
  const rejected=await new FileStore(root).listKeys(`projects/${projectId}/revisions/${bundle.revisionId}/visual-rejected`,2);expect(rejected.length).toBe(scenario==='corrected'||scenario==='exhausted'||scenario==='revoked'?1:0);
 }finally{marks.after=undefined;await new Promise<void>(resolve=>server.close(()=>resolve()));await rm(root,{recursive:true,force:true})}
});
it('pins the first MVP shot as a continuity reference and cold-rejects a changed first source without new decisions',async()=>{
 const root=await mkdtemp(join(tmpdir(),'vb-visual-continuity-')),projects=new ProjectStore(new FileStore(root)),{projectId}=await projects.create('owner',{schemaVersion:5,clientCommandId:randomUUID(),clientCreateId:randomUUID()}),operationId=randomUUID();
 try{
 const bundle=await seedPreviewBundle(projects,{projectId,briefVersion:1,durationSec:20,previewArtifactSha256:'a'.repeat(64)}),spec=(await projects.store.readFresh<FilmSpec>(bundle.filmSpecRef.key)).value,prefix=`projects/${projectId}/revisions/${bundle.revisionId}/`,t=(await projects.store.readFresh<{planRef:FilmSpec['treatmentRef']}>(spec.treatmentRef.key)).value;
 const {TreatmentPlanSchema}=await import('@/contracts/video/treatment'),{TimingDraftSchema}=await import('@/services/video/preview/timing-draft'),{canonicalHash}=await import('@/services/video/domain/hash');
 const original=TreatmentPlanSchema.parse((await projects.store.readFresh(t.planRef.key)).value),plan={...original,shots:[{...original.shots[0],endFrame:240},{...original.shots[0],id:'closing',startFrame:240}],script:[original.script[0],original.script[0]]},planRef=await projects.index.immutable(prefix+'treatment-plan',plan);
 const audio=(await projects.store.readFresh<{timingDraftRef:FilmSpec['treatmentRef']}>(spec.audioManifestRef.key)).value,draft=TimingDraftSchema.parse((await projects.store.readFresh(audio.timingDraftRef.key)).value),timing={...draft,shots:plan.shots.map(({id,startFrame,endFrame,visualIntent,factIds})=>({id,startFrame,endFrame,visualIntent,factIds}))},draftRef=await projects.index.immutable(prefix+'timing-draft',timing);clock.mockResolvedValue({draftRef});
 const sources=(await projects.store.readFresh<{modules:Array<{sourceRef:FilmSpec['treatmentRef']}>}>(spec.sourceManifestRef.key)).value,sourceModule=(await projects.store.readFresh<{visualSourceRef:FilmSpec['treatmentRef']}>(sources.modules[0].sourceRef.key)).value,source=(await projects.store.readFresh<VisualShotSource>(sourceModule.visualSourceRef.key)).value;
 await seedPreviewOperation(projects,operationId,bundle);await updateJson(projects.store,`projects/${projectId}/control`,(c:ProjectControl)=>({...c,phase:'preparing_preview' as const,briefVersion:1,activeProduction:operationId}));let decisions=0;
 const options={root,env:{VIDEO_DELIVERY_PROFILE:'mvp'},limits:{projectCalls:4,projectInputTokens:500000,projectOutputTokens:50000,dailyCalls:4},decide:async(_u:unknown,_t:unknown,_c:unknown,_h:string,shotId:string,_m:number,_e:unknown,_seed:number,_correction:unknown,continuity:VisualShotSource|undefined)=>{decisions++;if(shotId==='closing')expect(continuity).toEqual({...source,endFrame:240,timingDraftHash:canonicalHash(timing)});const s=plan.shots.find(s=>s.id===shotId)!;return{...source,shotId,startFrame:s.startFrame,endFrame:s.endFrame,timingDraftHash:canonicalHash(timing)}}};
 const first=await prepareVisualShotStage(projects,projectId,bundle.revisionId,operationId,0,planRef,'shot',options),second=await prepareVisualShotStage(projects,projectId,bundle.revisionId,operationId,0,planRef,'closing',options);expect(second.continuityRef).toEqual(first.sourceRef);expect(decisions).toBe(2);
 await expect(prepareVisualShotStage(projects,projectId,bundle.revisionId,operationId,0,planRef,'closing',{...options,mustExist:true})).resolves.toEqual(second);expect(decisions).toBe(2);
 await updateJson(projects.store,first.sourceRef.key,(s:VisualShotSource)=>({...s,sourceHtml:s.sourceHtml+'<!-- changed -->'}));
 await expect(prepareVisualShotStage(projects,projectId,bundle.revisionId,operationId,0,planRef,'closing',{...options,mustExist:true})).rejects.toThrow('VISUAL_REF_CHANGED');expect(decisions).toBe(2);
 }finally{await rm(root,{recursive:true,force:true})}
});
