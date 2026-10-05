import {rm} from 'node:fs/promises';
import {join} from 'node:path';
import {it,expect,vi} from 'vitest';
import * as sampling from '@/services/video/quality/whole-visual-plan';
import {seedApprovedProject} from './fixtures/approved-project';
import {loadApprovedRenderInputs} from '@/services/video/render/approved-inputs';
import {prepareApprovedVisualEvidence} from '@/services/video/render/visual-evidence';
import {reviewApprovedContent} from '@/services/video/render/content-review';
import type {composeApprovedFilm} from '@/services/video/render/composition';
import type {extractVisualFrames} from '@/services/video/quality/visual-evidence';
import {canonicalHash} from '@/services/video/domain/hash';
import type {ContentReviewContext,ContentReview} from '@/contracts/video/content-review';
import type {ProjectControl} from '@/contracts/video/project';
import {updateJson} from '@/services/video/storage/atomic-store';
async function producers(f:Awaited<ReturnType<typeof seedApprovedProject>>){
 const inputs=await loadApprovedRenderInputs(f.projects,'owner',f.projectId,f.operationId,0,{root:f.root,env:f.env}),sha256='a'.repeat(64);
 const compose:typeof composeApprovedFilm=async()=>({schemaVersion:2,inputHash:inputs.inputHash,pictureStageHash:'b'.repeat(64),audioExecutionSha256:'c'.repeat(64),movie:{stageKey:'d'.repeat(64),outputPath:join(f.root,'composition','d'.repeat(64),'output/final.mp4'),subtitlesPath:null,technicalQa:{result:'pass',sha256,bytes:2000,width:1920,height:1080,durationSec:20,fps:24,frames:480,audio:true,audioChannels:2},loudness:{status:'not_applicable',filmSha256:sha256,runtimeDigest:'1'.repeat(64),integratedLufs:null,truePeakDbtp:null,targetLufs:-14,toleranceLu:1,maxTruePeakDbtp:-1.2},qaStatus:'semantic_not_checked'},postMix:{status:'not_applicable',reason:'no_narration',filmSha256:sha256,executionSha256:'c'.repeat(64),voiceTrackSha256:'e'.repeat(64),lines:[]},qualityStatus:'semantic_not_checked',deliveryEligible:false});
 const extract:typeof extractVisualFrames=async(_root,film,frames,image)=>({schemaVersion:2,extractor:'ffmpeg-select-v2',stageKey:canonicalHash({film,frames}),filmSha256:film.sha256,runtimeDigest:image.slice(7),width:film.width,height:film.height,frames:frames.map((frame,index)=>({id:'frame-'+frame,frame,sha256:'f'.repeat(64),bytes:100,filename:'frame-'+String(index+1).padStart(4,'0')+'.png'}))});
 // Only producer boundaries are injected. This suite tests persistence and
 // fencing, and never claims physical media or actual semantic quality.
 return{root:f.root,env:f.env,compose,extract,readImages:async()=>new Map<string,Uint8Array>()};
}
function response(c:ContentReviewContext):ContentReview{return{schemaVersion:1,contextSha256:c.contextSha256,scope:'provided_frames_and_verified_transcripts',observations:c.frames.map(f=>({frameId:f.id,description:'本地归档协议样本。',visibleText:c.requirements.flatMap(r=>r.exactText)})),facts:c.facts.map(f=>({factId:f.id,result:'pass',coverage:'complete',reason:'单元测试给定完整字面观察。',evidence:[{kind:'frame_text',frameId:c.frames[0].id,quote:f.text}],literalChecks:c.requirements.find(r=>r.factId===f.id)!.exactText.map(sourceExcerpt=>({sourceExcerpt,result:'pass',evidence:[{kind:'frame_text',frameId:c.frames[0].id,quote:sourceExcerpt}],reason:'单元测试字面匹配。'}))})),conflicts:[]}}
it('archives complete approved content batches once and cold-verifies them without new decisions',async()=>{
 const f=await seedApprovedProject();try{const options=await producers(f);await prepareApprovedVisualEvidence(f.projects,'owner',f.projectId,f.operationId,0,options);let calls=0;
 const first=await reviewApprovedContent(f.projects,'owner',f.projectId,f.operationId,0,{...options,decide:async c=>{calls++;return response(c)}});expect(calls).toBe(first.batches.length);expect(first.report).toMatchObject({result:'pass',deliveryEligible:false,audio:'transcripts_only',continuousMotion:'not_supplied'});
 const cold=await reviewApprovedContent(f.projects,'owner',f.projectId,f.operationId,0,{...options,mustExist:true,decide:async()=>{throw Error('CONTENT_REPLAYED')}});expect(cold).toEqual(first);expect(calls).toBe(first.batches.length);
 let writes=0;const create=f.projects.store.create.bind(f.projects.store);f.projects.store.create=async()=>{writes++;throw Error('COLD_WRITE_FORBIDDEN')};await expect(reviewApprovedContent(f.projects,'owner',f.projectId,f.operationId,0,{...options,mustExist:true})).resolves.toEqual(first);expect(writes).toBe(0);f.projects.store.create=create;
 }finally{await rm(f.root,{recursive:true,force:true})}
},30000);
it('requires a durable stage before a read-only replay can touch composition',async()=>{
 const f=await seedApprovedProject();try{const options=await producers(f);let compositions=0;const original=options.compose;options.compose=async(...args)=>{compositions++;return original(...args)};
 await expect(reviewApprovedContent(f.projects,'owner',f.projectId,f.operationId,0,{...options,mustExist:true})).rejects.toThrow('CONTENT_REVIEW_MISSING');expect(compositions).toBe(0);
 }finally{await rm(f.root,{recursive:true,force:true})}
});
it('never retries an unknown content effect and never commits a stage after cancellation',async()=>{
 const f=await seedApprovedProject();try{const options=await producers(f);await prepareApprovedVisualEvidence(f.projects,'owner',f.projectId,f.operationId,0,options);let calls=0;const invoke=()=>reviewApprovedContent(f.projects,'owner',f.projectId,f.operationId,0,{...options,decide:async()=>{calls++;throw Error('PROVIDER_TIMEOUT')}});
 await expect(invoke()).rejects.toThrow('PROVIDER_TIMEOUT');await expect(invoke()).rejects.toThrow('EFFECT_UNKNOWN');expect(calls).toBe(1);
 await updateJson(f.projects.store,`projects/${f.projectId}/control`,(c:ProjectControl)=>({...c,consentEpoch:c.consentEpoch+1,activeProduction:null}));await expect(invoke()).rejects.toThrow('RENDER_FENCED');
 await expect(f.projects.store.readFresh(`projects/${f.projectId}/approvals/${f.approval.approvalId}/content-review-v1-stage`)).rejects.toThrow();
 }finally{await rm(f.root,{recursive:true,force:true})}
},30000);
it('stops after cancellation during the first decision and rejects changed images on cold replay',async()=>{
 const f=await seedApprovedProject();try{const options=await producers(f);await prepareApprovedVisualEvidence(f.projects,'owner',f.projectId,f.operationId,0,options);let calls=0;
 await expect(reviewApprovedContent(f.projects,'owner',f.projectId,f.operationId,0,{...options,decide:async c=>{calls++;await updateJson(f.projects.store,`projects/${f.projectId}/control`,(v:ProjectControl)=>({...v,consentEpoch:v.consentEpoch+1,activeProduction:null}));return response(c)}})).rejects.toThrow('RENDER_FENCED');expect(calls).toBe(1);
 await expect(f.projects.store.readFresh(`projects/${f.projectId}/approvals/${f.approval.approvalId}/content-review-v1-stage`)).rejects.toThrow();
 }finally{await rm(f.root,{recursive:true,force:true})}
 const g=await seedApprovedProject();try{const options=await producers(g);await prepareApprovedVisualEvidence(g.projects,'owner',g.projectId,g.operationId,0,options);await reviewApprovedContent(g.projects,'owner',g.projectId,g.operationId,0,{...options,decide:async c=>response(c)});
 await expect(reviewApprovedContent(g.projects,'owner',g.projectId,g.operationId,0,{...options,mustExist:true,readImages:async()=>{throw Error('VISUAL_EVIDENCE_CHANGED')},decide:async()=>{throw Error('MUST_NOT_CALL')}})).rejects.toThrow('VISUAL_EVIDENCE_CHANGED');
 }finally{await rm(g.root,{recursive:true,force:true})}
},30000);
it('stops on archive failure and reclaims a completed effect without another decision',async()=>{
 const f=await seedApprovedProject();try{const options=await producers(f);await prepareApprovedVisualEvidence(f.projects,'owner',f.projectId,f.operationId,0,options);let calls=0,fail=true;const create=f.projects.store.create.bind(f.projects.store);
 f.projects.store.create=async(key,value)=>{if(fail&&key.includes('/content-reviews/'))throw Error('ARCHIVE_WRITE_FAILED');return create(key,value)};
 const invoke=()=>reviewApprovedContent(f.projects,'owner',f.projectId,f.operationId,0,{...options,decide:async c=>{calls++;return response(c)}});
 await expect(invoke()).rejects.toThrow('ARCHIVE_WRITE_FAILED');expect(calls).toBe(1);fail=false;
 const result=await invoke();expect(calls).toBe(result.batches.length);expect(result.report.result).toBe('pass');
 }finally{await rm(f.root,{recursive:true,force:true})}
},30000);
it.each(['baseline','literal'] as const)('revalidates completed effect %s before archiving or requesting another batch',async fault=>{
 const f=await seedApprovedProject();try{const options=await producers(f);await prepareApprovedVisualEvidence(f.projects,'owner',f.projectId,f.operationId,0,options);let calls=0,fail=true;const create=f.projects.store.create.bind(f.projects.store);
 f.projects.store.create=async(key,value)=>{if(fail&&key.includes('/content-reviews/'))throw Error('ARCHIVE_WRITE_FAILED');return create(key,value)};
 const invoke=()=>reviewApprovedContent(f.projects,'owner',f.projectId,f.operationId,0,{...options,decide:async c=>{calls++;return response(c)}});
 await expect(invoke()).rejects.toThrow('ARCHIVE_WRITE_FAILED');expect(calls).toBe(1);fail=false;
 const effects=await f.projects.store.listKeys!(`projects/${f.projectId}/operations/${f.operationId}/effects/formal-content-critic`,1);expect(effects).toHaveLength(1);
 await updateJson(f.projects.store,effects[0],(effect:{output:ContentReview})=>({...effect,output:{...effect.output,...(fault==='baseline'?{contextSha256:'0'.repeat(64)}:{facts:effect.output.facts.map(fact=>({...fact,literalChecks:[]}))})}}));
 await expect(invoke()).rejects.toThrow(fault==='baseline'?'CONTENT_BASELINE_CHANGED':'CONTENT_LITERAL_EVIDENCE_INVALID');expect(calls).toBe(1);
 expect(await f.projects.store.listKeys!(`projects/${f.projectId}/approvals/${f.approval.approvalId}/content-reviews`,1)).toEqual([]);
 await expect(f.projects.store.readFresh(`projects/${f.projectId}/approvals/${f.approval.approvalId}/content-review-v1-stage`)).rejects.toThrow();
 }finally{await rm(f.root,{recursive:true,force:true})}
},30000);
it('executes independent rounds even when a valid sampling clock yields identical frame batches',async()=>{
 const realPlan=sampling.wholeFilmVisualPlan;
 // Inject only the sampling boundary. This legal clock makes the true sampling
 // algorithm select equal image sets; image reuse must not reuse QA decisions.
 const sample=vi.spyOn(sampling,'wholeFilmVisualPlan').mockImplementation(clock=>realPlan({...clock,captions:Array.from({length:20},(_,i)=>({startFrame:i*24,endFrame:(i+1)*24,stableReadableStartFrame:i*24+12}))}));
 const f=await seedApprovedProject();try{const options=await producers(f),evidence=await prepareApprovedVisualEvidence(f.projects,'owner',f.projectId,f.operationId,0,options);expect(evidence.record.plan.rounds[0].frames).toEqual(evidence.record.plan.rounds[1].frames);let calls=0;
 const stage=await reviewApprovedContent(f.projects,'owner',f.projectId,f.operationId,0,{...options,decide:async c=>{calls++;return response(c)}});expect(calls).toBe(stage.batches.length);
 expect(new Set(stage.batches.map(b=>b.contextRef.sha256)).size).toBe(stage.batches.length);expect(stage.batches.filter(b=>b.round===1)).toHaveLength(stage.batches.length/2);expect(stage.batches.filter(b=>b.round===2)).toHaveLength(stage.batches.length/2);
 expect(await f.projects.store.listKeys!(`projects/${f.projectId}/operations/${f.operationId}/effects/formal-content-critic`,1)).toHaveLength(stage.batches.length);
 }finally{sample.mockRestore();await rm(f.root,{recursive:true,force:true})}
},30000);
