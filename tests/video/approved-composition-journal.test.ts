import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {rm} from 'node:fs/promises';
import {join} from 'node:path';
import {seedApprovedProject} from './fixtures/approved-project';
import {cancelProduction} from '@/services/video/commands/cancel';
const ports=vi.hoisted(()=>({compose:vi.fn(),postmix:vi.fn(),qa:vi.fn(),pictures:vi.fn()}));
let clearPolicy=false;
vi.mock('@/services/video/media/compose',()=>({composeVideo:ports.compose}));
vi.mock('@/services/video/media/technical-qa',()=>({technicalVideoQa:ports.qa}));
vi.mock('@/services/video/audio/postmix-asr',()=>({verifyPostMixNarration:ports.postmix,verifyPostMixNoNarration:()=>{throw Error('UNEXPECTED_NARRATION_APPLICABILITY')}}));
vi.mock('@/services/video/render/pictures',()=>({renderApprovedPictures:ports.pictures}));
vi.mock('@/services/video/render/approved-inputs',async importOriginal=>{
 const actual=await importOriginal<typeof import('@/services/video/render/approved-inputs')>();
 return{...actual,loadApprovedRenderInputs:async(...args:Parameters<typeof actual.loadApprovedRenderInputs>)=>{
  const inputs=await actual.loadApprovedRenderInputs(...args);
  // Explicit audio/QA protocol fixture. No executed FilmPackage or media
  // quality is claimed; existing tests exercise authentic archived inputs.
  return{...inputs,frozen:{...inputs.frozen,...(clearPolicy?{filmSpec:{...inputs.frozen.filmSpec,qualityPolicyVersion:'v5.1-package-4-clear-book-captions'}}:{}),filmAudioTrack:{kind:'film_mix',qaStatus:'not_checked',outputPath:join(args[5].root,'audio-master','fixture','output','master.wav'),runtimeDigest:inputs.frozen.filmSpec.runtimeDigest,wav:{channels:2,silence:true,sha256:'a'.repeat(64)}},audioManifest:{...inputs.frozen.audioManifest,executionRef:{key:`projects/${args[2]}/revisions/${inputs.bundle.revisionId}/audio-execution/fixture`,sha256:'b'.repeat(64),bytes:2,mime:'application/json'}}}};
 }};
});
import {composeApprovedFilm} from '@/services/video/render/composition';
let fixture:Awaited<ReturnType<typeof seedApprovedProject>>;
beforeEach(async()=>{
 clearPolicy=false;fixture=await seedApprovedProject();for(const port of Object.values(ports))port.mockReset();
 const qa={sha256:'c'.repeat(64),bytes:2048};ports.qa.mockResolvedValue(qa);ports.pictures.mockResolvedValue({sequence:{stageKey:'d'.repeat(64)}});
 ports.compose.mockImplementation(async(...args)=>{const options=args[7];if(!options.journal)throw Error('MEDIA_JOURNAL_CONTEXT_MISSING');await options.assertActive();return{stageKey:'e'.repeat(64),outputPath:join(fixture.root,'composition','fixture','output','final.mp4'),technicalQa:qa,loudness:{filmSha256:qa.sha256},qaStatus:'semantic_not_checked'}});
 ports.postmix.mockImplementation(async(...args)=>{const options=args[6];if(!options.journal)throw Error('MEDIA_JOURNAL_CONTEXT_MISSING');await options.assertActive();return{status:'not_applicable',reason:'protocol_silence'}});
});
afterEach(async()=>{await rm(fixture.root,{recursive:true,force:true})});
it('binds composition and postmix to the real approved operation journal and verifies completed stage reuse',async()=>{
 const f=fixture,run=()=>composeApprovedFilm(f.projects,'owner',f.projectId,f.operationId,0,{root:f.root,env:f.env});
 const first=await run();expect(await run()).toEqual(first);
 const composition=ports.compose.mock.calls[0][7],postmix=ports.postmix.mock.calls[0][6],expected={store:f.projects.store,prefix:`projects/${f.projectId}/operations/${f.operationId}/media-effects`};
 expect(composition.journal).toEqual(expected);expect(postmix.journal).toEqual(expected);expect(postmix.journal).toBe(composition.journal);
 expect(first.deliveryEligible).toBe(false);
});
it('does not continue postmix or save a stage after composition observes actual cancellation',async()=>{
 const f=fixture;ports.compose.mockImplementation(async(...args)=>{const options=args[7];if(!options.journal)throw Error('MEDIA_JOURNAL_CONTEXT_MISSING');await options.assertActive();await cancelProduction(f.projects.store,f.projectId,f.operationId);await options.assertActive();throw Error('REVOCATION_NOT_OBSERVED')});
 await expect(composeApprovedFilm(f.projects,'owner',f.projectId,f.operationId,0,{root:f.root,env:f.env})).rejects.toThrow('RENDER_FENCED');expect(ports.postmix).not.toHaveBeenCalled();
 await expect(f.projects.store.readFresh(`projects/${f.projectId}/approvals/${f.approval.approvalId}/composite-v2-stage`)).rejects.toThrow('STORE_NOT_FOUND');
});

it('freezes new stereo extraction and cold replays successful pre-marker policy4 stages with the legacy protocol',async()=>{
 clearPolicy=true;
 const f=fixture,run=()=>composeApprovedFilm(f.projects,'owner',f.projectId,f.operationId,0,{root:f.root,env:f.env,mustExist:true});
 const fresh=await composeApprovedFilm(f.projects,'owner',f.projectId,f.operationId,0,{root:f.root,env:f.env});
 expect(fresh.postMixDownmix).toBe('stereo_average');
 expect(ports.postmix.mock.calls[0][6].downmix).toBe('stereo_average');
 expect(await run()).toEqual(fresh);
 expect(ports.postmix.mock.calls[1][6]).toMatchObject({downmix:'stereo_average',mustExist:true});
 // Protocol-only historical fixture: successful stages before the migration
 // contain no algorithm marker. Replaying must retain their original v1 key.
 const key=`projects/${f.projectId}/approvals/${f.approval.approvalId}/composite-v2-stage`;
 const saved=await f.projects.store.readFresh<typeof fresh>(key);
 const legacy={...fresh};delete legacy.postMixDownmix;
 await f.projects.store.cas(key,saved.etag,legacy);
 expect(await run()).toEqual(legacy);
 expect(ports.postmix.mock.calls[2][6].downmix).toBeUndefined();
 expect(ports.postmix.mock.calls[2][6].mustExist).toBe(true);
 expect((await f.projects.store.readFresh(key)).value).toEqual(legacy);
});
