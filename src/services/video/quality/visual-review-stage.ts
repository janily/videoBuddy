import {join,isAbsolute} from 'node:path';
import {z} from 'zod';
import type {ObjectRef} from '@/contracts/video/domain';
import type {ProjectControl} from '@/contracts/video/project';
import {loadVerifiedFilmPackage} from '@/contracts/video/film-package';
import {guardVisualReview,visualReviewContext,type VisualReviewContext,type VisualReview} from '@/contracts/video/visual-review';
import {runVisualCritic,prepareVisualCriticInput} from '@/mastra/video/critic';
import type {Environment} from '@/services/video/config/environment';
import {readConfiguration,requireGeneration} from '@/services/video/config/environment';
import {reserveModelBudget,modelLimits,type ModelLimits} from '@/services/video/budget/model-budget';
import {withAccountedModel} from '@/services/video/budget/model-call';
import {runEffect} from '@/services/video/commands/effect-ledger';
import {canonicalHash,canonicalJson} from '@/services/video/domain/hash';
import {technicalVideoQa} from '@/services/video/media/technical-qa';
import {dockerConfiguration} from '@/services/video/media/docker-executor';
import {assertPreviewProductionFence} from '@/services/video/preview/fence';
import {readNarrationJson} from '@/services/video/audio/narration-package';
import type {ProjectStore} from '@/services/video/storage/project-store';
import {StoreMissing,createOrRead} from '@/services/video/storage/atomic-store';
import {getStyle} from '@/services/video/styles/registry';
import {loadStageKnowledge} from '@/services/video/styles/knowledge-loader';
import {extractVisualFrames,readVisualEvidence} from './visual-evidence';
import {verifyCompositeForFilm} from './composite-binding';
import {frozenVisualCriteria} from './source-visual-criteria';
const digest=z.string().regex(/^[a-f0-9]{64}$/);
const recordSchema=z.strictObject({schemaVersion:z.literal(1),filmSpecRef:z.object({key:z.string(),sha256:digest,bytes:z.number().int().positive(),mime:z.literal('application/json')}),compositeSha256:digest,evidenceRef:z.object({key:z.string(),sha256:digest,bytes:z.number().int().positive(),mime:z.literal('application/json')}),contextRef:z.object({key:z.string(),sha256:digest,bytes:z.number().int().positive(),mime:z.literal('application/json')}),reviewRef:z.object({key:z.string(),sha256:digest,bytes:z.number().int().positive(),mime:z.literal('application/json')}),qualityStatus:z.literal('sampled_visuals_only')});
const compositeSchema=z.object({schemaVersion:z.literal(4),briefVersion:z.number().int(),treatmentSha256:digest,profile:z.enum(['full','preview']),stageKey:digest,outputPath:z.string(),technicalQa:z.object({result:z.literal('pass'),sha256:digest,bytes:z.number().int().positive(),width:z.number().int(),height:z.number().int(),durationSec:z.number(),fps:z.number(),frames:z.number().int(),audio:z.boolean()}),qualityStatus:z.literal('semantic_not_checked')});
interface Options{root?:string;env?:Environment;limits?:ModelLimits;mustExist?:boolean;verifyComposite?:typeof verifyCompositeForFilm;qa?:typeof technicalVideoQa;extract?:typeof extractVisualFrames;readImages?:typeof readVisualEvidence;decide?:(context:VisualReviewContext,images:ReadonlyMap<string,Uint8Array>)=>Promise<VisualReview>}

// A batch is evidence, never a complete visual/listening approval or delivery report.
export async function prepareVisualReviewBatch(projects:ProjectStore,projectId:string,revisionId:string,operationId:string,expectedConsentEpoch:number,filmSpecRef:ObjectRef,profile:'full'|'preview',frames:number[],round:1|2,options:Options={}){
 if(![projectId,revisionId,operationId].every(id=>z.uuid().safeParse(id).success)||![1,2].includes(round)||!['full','preview'].includes(profile))throw Error('CRITIC_INPUT_INVALID');
 const env=options.env||process.env,candidateRoot=options.root||env.VIDEO_DATA_DIR;if(!candidateRoot||!isAbsolute(candidateRoot))throw Error('CONFIGURATION_REQUIRED: VIDEO_DATA_DIR');const root:string=candidateRoot;
 const prefix='projects/'+projectId,revisionPrefix=prefix+'/revisions/'+revisionId+'/',control=(await projects.store.readFresh<ProjectControl>(prefix+'/control')).value;
 assertPreviewProductionFence(control,projectId,operationId,expectedConsentEpoch);
 const rawSpec=await readNarrationJson(projects.store,filmSpecRef,revisionPrefix+'film/'),frozen=await loadVerifiedFilmPackage(projects.store,rawSpec,root),spec=frozen.filmSpec;
 if(spec.projectId!==projectId||spec.revisionId!==revisionId||spec.briefVersion!==control.briefVersion||canonicalHash(spec.understandingRef)!==canonicalHash(control.understandingRef))throw Error('CRITIC_BASELINE_CHANGED');
 const rawComposite=await (options.verifyComposite||verifyCompositeForFilm)(projects,root,frozen,operationId,expectedConsentEpoch,profile,env),movie=compositeSchema.parse(rawComposite),config=dockerConfiguration(env,operationId);
 const landscape=spec.output.width>spec.output.height,width=profile==='full'?spec.output.width:landscape?1280:720,height=profile==='full'?spec.output.height:landscape?720:1280;
 if(spec.runtimeDigest!==config.runtimeDigest||movie.profile!==profile||movie.briefVersion!==spec.briefVersion||movie.treatmentSha256!==frozen.treatment.planRef.sha256||movie.outputPath!==join(root,'composition',movie.stageKey,'output/final.mp4')||movie.technicalQa.width!==width||movie.technicalQa.height!==height||movie.technicalQa.frames!==spec.output.totalFrames||movie.technicalQa.fps!==spec.output.fps)throw Error('CRITIC_BASELINE_CHANGED');
 const actual=await (options.qa||technicalVideoQa)(join(root,'composition',movie.stageKey),config.image,'output/final.mp4',{width,height,durationSec:spec.output.totalFrames/spec.output.fps,fps:spec.output.fps,audio:true});
 if(actual.sha256!==movie.technicalQa.sha256||actual.bytes!==movie.technicalQa.bytes||actual.frames!==spec.output.totalFrames)throw Error('CRITIC_FILM_CHANGED');
 const compositeSha256=canonicalHash(rawComposite),stageKey=canonicalHash({filmSpecSha256:filmSpecRef.sha256,compositeSha256,frames,round,runtimeDigest:config.runtimeDigest}),key=revisionPrefix+'visual-review-batches/'+stageKey;
 let existing:z.infer<typeof recordSchema>|undefined;try{existing=recordSchema.parse((await projects.store.readFresh(key)).value)}catch(error){if(!(error instanceof StoreMissing))throw error}
 if(!existing&&options.mustExist)throw Error('CRITIC_REVIEW_MISSING');
 const evidence=await (options.extract||extractVisualFrames)(root,{outputPath:movie.outputPath,sha256:actual.sha256,width,height,totalFrames:spec.output.totalFrames},frames,config.image),images=await (options.readImages||readVisualEvidence)(root,evidence);
 if(evidence.filmSha256!==actual.sha256||evidence.runtimeDigest!==config.runtimeDigest||evidence.width!==width||evidence.height!==height||canonicalHash(evidence.frames.map(f=>f.frame))!==canonicalHash(frames))throw Error('CRITIC_EVIDENCE_INVALID');
 const sourceCriteria=frozenVisualCriteria(frozen),context=visualReviewContext({filmSha256:actual.sha256,filmSpecSha256:filmSpecRef.sha256,styleSlug:spec.style.slug,styleRulesHash:getStyle(spec.style.slug).rulesHash,round,frames:evidence.frames.map(({id,frame,sha256,bytes})=>({id,frame,sha256,bytes})),facts:frozen.facts.facts.filter(fact=>fact.critical||fact.mustInclude).map(({id,text})=>({id,text})),...(sourceCriteria?{sourceCriteria}:{})});
 async function assertCurrent(){const latest=(await projects.store.readFresh<ProjectControl>(prefix+'/control')).value;assertPreviewProductionFence(latest,projectId,operationId,expectedConsentEpoch,{briefVersion:control.briefVersion,understandingRef:control.understandingRef});if(canonicalHash((await projects.store.readFresh(revisionPrefix+'composite-v4/'+profile)).value)!==compositeSha256)throw Error('CRITIC_BASELINE_CHANGED')}
 async function verify(record:z.infer<typeof recordSchema>){
  if(canonicalHash(record.filmSpecRef)!==canonicalHash(filmSpecRef)||record.compositeSha256!==compositeSha256)throw Error('CRITIC_BASELINE_CHANGED');
  const [savedContext,savedEvidence,review]=await Promise.all([readNarrationJson(projects.store,record.contextRef,revisionPrefix+'visual-review-context/'),readNarrationJson(projects.store,record.evidenceRef,revisionPrefix+'visual-frame-evidence/'),readNarrationJson(projects.store,record.reviewRef,revisionPrefix+'visual-review/')]);
  if(canonicalHash(savedContext)!==canonicalHash(context)||canonicalHash(savedEvidence)!==canonicalHash(evidence))throw Error('CRITIC_EVIDENCE_INVALID');guardVisualReview(review,context);await (options.readImages||readVisualEvidence)(root,evidence);await assertCurrent();return record;
 }
 if(existing)return verify(existing);
 const effectKey=prefix+'/operations/'+operationId+'/effects/visual-critic/'+stageKey;
 let prior:unknown;try{prior=(await projects.store.readFresh(effectKey)).value}catch(error){if(!(error instanceof StoreMissing))throw error}
 let execute:()=>Promise<VisualReview>;
 if(options.decide){const decide=options.decide;execute=()=>decide(context,images)}else{
  if(prior===undefined){
   requireGeneration(readConfiguration(env));await prepareVisualCriticInput(context,images,8000);await assertCurrent();const knowledge=await loadStageKnowledge(spec.style.slug,'style'),reservation=await reserveModelBudget(projects.store,projectId,operationId+'-critic-'+stageKey,{inputTokens:Buffer.byteLength(canonicalJson({context,styleRules:knowledge.rules}))+4096+frames.length*8192,outputTokens:8000},options.limits||modelLimits(env));
   execute=()=>withAccountedModel(projects.store,reservation.reservation,()=>runVisualCritic(context,images,reservation.maxOutputTokens,env,{assertActive:assertCurrent}));
  }else execute=async()=>{throw Error('CRITIC_EFFECT_CHANGED')};
 }
 await assertCurrent();
 const review=guardVisualReview(await runEffect(projects.store,effectKey,async()=>{
  return guardVisualReview(await execute(),context);
 }),context);
 await assertCurrent();await (options.readImages||readVisualEvidence)(root,evidence);
 const [contextRef,evidenceRef,reviewRef]=await Promise.all([projects.index.immutable(revisionPrefix+'visual-review-context',context),projects.index.immutable(revisionPrefix+'visual-frame-evidence',evidence),projects.index.immutable(revisionPrefix+'visual-review',review)]);
 const record=recordSchema.parse({schemaVersion:1,filmSpecRef,compositeSha256,contextRef,evidenceRef,reviewRef,qualityStatus:'sampled_visuals_only'});
 const stored=await createOrRead(projects.store,key,record);if(canonicalHash(stored)!==canonicalHash(record))throw Error('CRITIC_BASELINE_CHANGED');return verify(stored);
}
