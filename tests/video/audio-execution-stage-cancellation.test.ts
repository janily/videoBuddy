import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
const {audio,timing,stems,master,archive,load,inspect}=vi.hoisted(()=>({audio:vi.fn(),timing:vi.fn(),stems:vi.fn(),master:vi.fn(),archive:vi.fn(),load:vi.fn(),inspect:vi.fn()}));
vi.mock('@/services/video/preview/audio-plan-stage',()=>({prepareAudioPlanStage:audio}));
vi.mock('@/services/video/preview/timing-stage',()=>({prepareTimingStage:timing}));
vi.mock('@/services/video/audio/sound',()=>({buildSoundStems:stems}));
vi.mock('@/services/video/audio/master',()=>({buildAudioMaster:master}));
vi.mock('@/services/video/audio/execution-package',()=>({archiveAudioExecution:archive,loadAudioExecution:load}));
vi.mock('@/services/video/audio/wav',()=>({inspectTrackWav:inspect}));
import {prepareAudioExecutionStage} from '@/services/video/preview/audio-execution-stage';
import {ProjectStore} from '@/services/video/storage/project-store';
import {FileStore} from '@/services/video/storage/file-store';
import {updateJson} from '@/services/video/storage/atomic-store';
import type {ProjectControl} from '@/contracts/video/project';
import {FilmSpecSchema} from '@/contracts/video/film';
import {AudioManifestSchema} from '@/contracts/video/film-package';
import {TimingDraftSchema} from '@/services/video/preview/timing-draft';
import {cancelProduction} from '@/services/video/commands/cancel';
import {seedPreviewBundle,seedPreviewOperation} from './fixtures/preview-package';
let root:string;
beforeEach(async()=>{root=await mkdtemp(join(tmpdir(),'vb-audio-stage-cancel-'));for(const mock of [audio,timing,stems,master,archive,load,inspect])mock.mockReset()});
afterEach(async()=>{await rm(root,{recursive:true,force:true})});
async function fixture(profile?:'mvp',hasVoice=false){
 const projects=new ProjectStore(new FileStore(root)),{projectId}=await projects.create('owner',{schemaVersion:5,clientCommandId:randomUUID(),clientCreateId:randomUUID()}),operationId=randomUUID(),revisionId=randomUUID();
 const bundle=await seedPreviewBundle(projects,{projectId,revisionId,briefVersion:1,durationSec:20,previewArtifactSha256:'b'.repeat(64)}),spec=FilmSpecSchema.parse((await projects.store.readFresh(bundle.filmSpecRef.key)).value);
 const manifest=AudioManifestSchema.parse((await projects.store.readFresh(spec.audioManifestRef.key)).value),draft=TimingDraftSchema.parse((await projects.store.readFresh(manifest.timingDraftRef.key)).value);
 await seedPreviewOperation(projects,operationId,bundle);await updateJson(projects.store,`projects/${projectId}/control`,(c:ProjectControl)=>({...c,phase:'preparing_preview' as const,briefVersion:1,activeProduction:operationId}));
 audio.mockResolvedValue({planRef:manifest.planRef});timing.mockResolvedValue({draftRef:manifest.timingDraftRef});inspect.mockResolvedValue({sha256:draft.track.sha256,silence:!hasVoice});
 // Producer outputs/load are simulated: this verifies real persisted fences,
 // callback wiring and stage recovery, not audio bytes or quality.
 stems.mockImplementation(async(_root,_plan,_duration,_fps,_env,options?:{assertActive?:()=>Promise<void>})=>{if(!options?.assertActive)throw Error('PRODUCER_FENCE_MISSING');await options.assertActive();return{stageKey:'a'.repeat(64)}});
 master.mockImplementation(async(_root,_plan,_voice,_stems,_duration,_fps,_env,options?:{assertActive?:()=>Promise<void>})=>{if(!options?.assertActive)throw Error('PRODUCER_FENCE_MISSING');await options.assertActive();return{stageKey:'b'.repeat(64)}});
 archive.mockResolvedValue({key:`projects/${projectId}/revisions/${revisionId}/audio-execution/`+'f'.repeat(64),sha256:'f'.repeat(64),bytes:2,mime:'application/json'});load.mockResolvedValue(undefined);
 const env={VIDEO_DELIVERY_PROFILE:profile,VIDEO_MEDIA_IMAGE_REF:'sha256:'+spec.runtimeDigest,VIDEO_MEDIA_RUNTIME_DIGEST:spec.runtimeDigest,VIDEO_MEDIA_TIMEOUT_SECONDS:'37'};
 const run=()=>prepareAudioExecutionStage(projects,projectId,revisionId,operationId,0,spec.treatmentRef,{root,env});return{projects,projectId,operationId,run};
}
it('passes the same durable production fence to synthesis and master, with cold completed-stage reuse',async()=>{
 const f=await fixture(),record=await f.run();expect(await f.run()).toEqual(record);expect(stems).toHaveBeenCalledTimes(1);expect(master).toHaveBeenCalledTimes(1);expect(archive).toHaveBeenCalledTimes(1);
 expect(stems.mock.calls[0][5].assertActive).toBe(master.mock.calls[0][7].assertActive);
 expect(stems.mock.calls[0][5].journal).toBe(master.mock.calls[0][7].journal);
 expect(stems.mock.calls[0][5].journal).toEqual({store:f.projects.store,prefix:`projects/${f.projectId}/operations/${f.operationId}/media-effects`});
});
it.each(['sound','master'] as const)('a revocation observed inside %s prevents audio package and completed stage publication',async producer=>{
 const f=await fixture(),revoke=async(options?:{assertActive?:()=>Promise<void>})=>{if(!options?.assertActive)throw Error('PRODUCER_FENCE_MISSING');await options.assertActive();await cancelProduction(f.projects.store,f.projectId,f.operationId);await options.assertActive();throw Error('REVOCATION_NOT_OBSERVED')};
 if(producer==='sound')stems.mockImplementation(async(_a,_b,_c,_d,_e,options)=>revoke(options));else master.mockImplementation(async(_a,_b,_c,_d,_e,_f,_g,options)=>revoke(options));
 await expect(f.run()).rejects.toThrow('PREVIEW_STALE');expect(archive).not.toHaveBeenCalled();if(producer==='sound')expect(master).not.toHaveBeenCalled();
});

it.each([{profile:'mvp' as const,hasVoice:true,priority:'voice-first-v1'},{profile:'mvp' as const,hasVoice:false,priority:undefined},{profile:undefined,hasVoice:true,priority:undefined}])('selects voice-first only for new MVP narration and keeps completed runs frozen: %j',async({profile,hasVoice,priority})=>{
 const f=await fixture(profile,hasVoice);await f.run();
 expect(master.mock.calls[0][7].speechPriority).toBe(priority);
 await f.run();expect(master).toHaveBeenCalledTimes(1);
});
