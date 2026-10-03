import {rm} from 'node:fs/promises';
import {join} from 'node:path';
import {expect,it} from 'vitest';
import {canonicalHash} from '@/services/video/domain/hash';
import {updateJson} from '@/services/video/storage/atomic-store';
import type {ProjectControl} from '@/contracts/video/project';
import type {composeApprovedFilm} from '@/services/video/render/composition';
import {loadApprovedRenderInputs} from '@/services/video/render/approved-inputs';
import {prepareApprovedVisualEvidence} from '@/services/video/render/visual-evidence';
import {reviewApprovedWholeFilm} from '@/services/video/render/visual-review';
import type {extractVisualFrames} from '@/services/video/quality/visual-evidence';
import type {VisualReviewContext,VisualReview} from '@/contracts/video/visual-review';
import {seedApprovedProject} from './fixtures/approved-project';

async function mocks(f:Awaited<ReturnType<typeof seedApprovedProject>>){
 const inputs=await loadApprovedRenderInputs(f.projects,'owner',f.projectId,f.operationId,0,{root:f.root,env:f.env}),sha256='a'.repeat(64);
 const compose:typeof composeApprovedFilm=async()=>({schemaVersion:2,inputHash:inputs.inputHash,pictureStageHash:'b'.repeat(64),audioExecutionSha256:'c'.repeat(64),movie:{stageKey:'d'.repeat(64),outputPath:join(f.root,'composition','d'.repeat(64),'output/final.mp4'),subtitlesPath:null,technicalQa:{result:'pass',sha256,bytes:2000,width:1920,height:1080,durationSec:20,fps:24,frames:480,audio:true,audioChannels:2},loudness:{status:'not_applicable',filmSha256:sha256,runtimeDigest:'1'.repeat(64),integratedLufs:null,truePeakDbtp:null,targetLufs:-14,toleranceLu:1,maxTruePeakDbtp:-1.2},qaStatus:'semantic_not_checked'},postMix:{status:'not_applicable',reason:'no_narration',filmSha256:sha256,executionSha256:'c'.repeat(64),voiceTrackSha256:'e'.repeat(64),lines:[]},qualityStatus:'semantic_not_checked',deliveryEligible:false});
 const extract:typeof extractVisualFrames=async(_root,film,frames,image)=>({schemaVersion:2,extractor:'ffmpeg-select-v2',stageKey:canonicalHash({film,frames}),filmSha256:film.sha256,runtimeDigest:image.slice(7),width:film.width,height:film.height,frames:frames.map((frame,index)=>({id:'frame-'+frame,frame,sha256:'f'.repeat(64),bytes:100,filename:'frame-'+String(index+1).padStart(4,'0')+'.png'}))});
 return{root:f.root,env:f.env,compose,extract,readImages:async()=>new Map<string,Uint8Array>()};
}
function pass(context:VisualReviewContext):VisualReview{return{schemaVersion:1,filmSha256:context.filmSha256,filmSpecSha256:context.filmSpecSha256,frameSetSha256:context.frameSetSha256,styleSlug:context.styleSlug,styleRulesHash:context.styleRulesHash,round:context.round,scope:'sampled_frames',observations:context.frames.map(frame=>({frameId:frame.id,visibleText:context.facts.map(f=>f.text),issues:[]})),facts:context.facts.map(f=>({factId:f.id,result:'pass',frameIds:[context.frames[0].id],reason:'fixture observation'})),style:{result:'pass',frameIds:[context.frames[0].id],reason:'fixture'},readability:{result:'pass',frameIds:[context.frames[0].id],reason:'fixture'}}}

it('collects all planned evidence and reuses durable whole-film reviews without new critic calls',async()=>{
 const f=await seedApprovedProject();try{
  const options=await mocks(f),before=(await f.projects.store.readFresh(`projects/${f.projectId}/control`)).value;
  const evidence=await prepareApprovedVisualEvidence(f.projects,'owner',f.projectId,f.operationId,0,options);let calls=0;
  const reviewed=await reviewApprovedWholeFilm(f.projects,'owner',f.projectId,f.operationId,0,{...options,decide:async context=>{calls++;return pass(context)}});
  expect(calls).toBe(evidence.record.batches.length);expect(reviewed.report).toMatchObject({result:'pass',audio:'not_supplied',continuousMotion:'not_supplied',deliveryEligible:false});
  const replay=await reviewApprovedWholeFilm(f.projects,'owner',f.projectId,f.operationId,0,{...options,mustExist:true,decide:async()=>{throw Error('CRITIC_REPLAYED')}});
  expect(replay).toEqual(reviewed);expect((await f.projects.store.readFresh(`projects/${f.projectId}/control`)).value).toEqual(before);
 }finally{await rm(f.root,{recursive:true,force:true})}
},30000);
it('revoked approval during extraction archives no complete evidence stage',async()=>{
 const f=await seedApprovedProject();try{
  const options=await mocks(f),original=options.extract;let calls=0;
  options.extract=async(...args)=>{calls++;await updateJson(f.projects.store,`projects/${f.projectId}/control`,(c:ProjectControl)=>({...c,consentEpoch:c.consentEpoch+1,activeProduction:null}));await args[4]?.assertActive?.();return original(...args)};
  await expect(prepareApprovedVisualEvidence(f.projects,'owner',f.projectId,f.operationId,0,options)).rejects.toThrow('RENDER_FENCED');expect(calls).toBe(1);
  await expect(f.projects.store.readFresh(`projects/${f.projectId}/approvals/${f.approval.approvalId}/visual-evidence-v1-stage`)).rejects.toThrow();
 }finally{await rm(f.root,{recursive:true,force:true})}
});
it('requires an existing evidence stage before invoking any composition during read-only replay',async()=>{
 const f=await seedApprovedProject();try{
  const options=await mocks(f),original=options.compose;let compositions=0;
  options.compose=async(...args)=>{compositions++;return original(...args)};
  await expect(prepareApprovedVisualEvidence(f.projects,'owner',f.projectId,f.operationId,0,{...options,mustExist:true})).rejects.toThrow('CRITIC_EVIDENCE_MISSING');
  expect(compositions).toBe(0);
 }finally{await rm(f.root,{recursive:true,force:true})}
});
it('rechecks the approval after the durable effect start and before invoking the critic',async()=>{
 const f=await seedApprovedProject();try{
  const options=await mocks(f);await prepareApprovedVisualEvidence(f.projects,'owner',f.projectId,f.operationId,0,options);
  const create=f.projects.store.create.bind(f.projects.store);let calls=0;
  f.projects.store.create=async(key,value)=>{
   const result=await create(key,value);
   if(key.includes('/effects/formal-visual-critic/'))await updateJson(f.projects.store,`projects/${f.projectId}/control`,(c:ProjectControl)=>({...c,consentEpoch:c.consentEpoch+1,activeProduction:null}));
   return result;
  };
  await expect(reviewApprovedWholeFilm(f.projects,'owner',f.projectId,f.operationId,0,{...options,decide:async context=>{calls++;return pass(context)}})).rejects.toThrow('RENDER_FENCED');
  expect(calls).toBe(0);
 }finally{await rm(f.root,{recursive:true,force:true})}
},30000);
it('does not retry a critic whose durable effect has an unknown outcome',async()=>{
 const f=await seedApprovedProject();try{
  const options=await mocks(f);let calls=0;
  const decide=async()=>{calls++;throw Error('PROVIDER_TIMEOUT')};
  await expect(reviewApprovedWholeFilm(f.projects,'owner',f.projectId,f.operationId,0,{...options,decide})).rejects.toThrow('PROVIDER_TIMEOUT');
  await expect(reviewApprovedWholeFilm(f.projects,'owner',f.projectId,f.operationId,0,{...options,decide})).rejects.toThrow('EFFECT_UNKNOWN');expect(calls).toBe(1);
  await expect(f.projects.store.readFresh(`projects/${f.projectId}/approvals/${f.approval.approvalId}/whole-visual-review-v1-stage`)).rejects.toThrow();
 }finally{await rm(f.root,{recursive:true,force:true})}
},30000);
