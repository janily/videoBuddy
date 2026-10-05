import {z} from 'zod';
import {ObjectRefSchema,type ObjectRef} from '@/contracts/video/domain';
import {contentReviewContext,guardContentReview,supportsContentPronunciationEvidence,type ContentReview,type ContentReviewContext} from '@/contracts/video/content-review';
import {runContentCritic} from '@/mastra/video/content-critic';
import {ProjectStore} from '@/services/video/storage/project-store';
import {StoreMissing,createOrRead,type AtomicStore} from '@/services/video/storage/atomic-store';
import {canonicalHash,canonicalJson} from '@/services/video/domain/hash';
import {loadPackagedNarration} from '@/services/video/audio/narration-package';
import {readNarrationJson} from '@/services/video/audio/narration-package';
import {VisualEvidenceSchema,readVisualEvidence} from '@/services/video/quality/visual-evidence';
import {wholeFilmVisualPlan,mvpFilmVisualPlan} from '@/services/video/quality/whole-visual-plan';
import {readConfiguration,requireGeneration} from '@/services/video/config/environment';
import {reserveModelBudget,modelLimits,type ModelLimits} from '@/services/video/budget/model-budget';
import {withAccountedModel} from '@/services/video/budget/model-call';
import {runEffect} from '@/services/video/commands/effect-ledger';
import {assertApprovedRenderFence,loadApprovedRenderInputs} from './approved-inputs';
import {composeApprovedFilm} from './composition';
import type {prepareApprovedVisualEvidence} from './visual-evidence';
const digest=z.string().regex(/^[a-f0-9]{64}$/);
const BatchBase={round:z.union([z.literal(1),z.literal(2)]),index:z.number().int().nonnegative(),inputHash:digest,compositionHash:digest,requirementsRef:ObjectRefSchema,contextRef:ObjectRefSchema,reviewRef:ObjectRefSchema};
const BatchSchema=z.union([z.strictObject({schemaVersion:z.literal(1),...BatchBase,evidenceRef:ObjectRefSchema}),z.strictObject({schemaVersion:z.literal(2),...BatchBase,evidenceRefs:z.array(ObjectRefSchema).min(1)})]);
type Options=Parameters<typeof prepareApprovedVisualEvidence>[5]&{limits?:ModelLimits;decide?:(context:ContentReviewContext,images:ReadonlyMap<string,Uint8Array>)=>Promise<ContentReview>};
type Result='pass'|'fail'|'not_checked';
function combine(values:Result[]):Result{return values.includes('fail')?'fail':values.every(value=>value==='pass')?'pass':'not_checked'}
function immutableRef(prefix:string,value:unknown):ObjectRef{const body=canonicalJson(value),sha256=canonicalHash(value);return{key:prefix+'/'+sha256,sha256,bytes:Buffer.byteLength(body),mime:'application/json'}}
// Some frozen producers use idempotent create even during replay. Permit only
// identical existing values, without invoking any underlying mutation.
export function verifierStore(store:AtomicStore):AtomicStore{return{
 readFresh:store.readFresh.bind(store),
 async create(key,value){const existing=await store.readFresh(key);if(canonicalHash(existing.value)!==canonicalHash(value))throw Error('CONTENT_COLD_WRITE_FORBIDDEN')},
 async cas(){throw Error('CONTENT_COLD_WRITE_FORBIDDEN')},
 ...(store.listKeys?{listKeys:store.listKeys.bind(store)}:{}),
}}
/** Complete two-round content evidence. Requirements come from the independently
 * audited immutable source proof, with conservative whole-text literals for
 * historical packages. They are never chosen by the film Critic.
 * This stage does not replace the old literal visual or listening gates. */
export async function reviewApprovedContent(projects:ProjectStore,owner:string,projectId:string,operationId:string,fence:number,options:Options){
 const env=options.env||process.env,{root}=options,inputs=await loadApprovedRenderInputs(projects,owner,projectId,operationId,fence,{root,env}),prefix=`projects/${projectId}/approvals/${inputs.approval.approvalId}/`,key=prefix+'content-review-v1-stage';
 let previous:unknown;
 try{previous=(await projects.store.readFresh(key)).value}catch(error){if(!(error instanceof StoreMissing))throw error}
 if(options.mustExist&&previous===undefined)throw Error('CONTENT_REVIEW_MISSING');
 const readOnly=Boolean(options.mustExist||previous!==undefined),verifier=new ProjectStore(verifierStore(projects.store));
 const composition=await (options.compose||composeApprovedFilm)(verifier,owner,projectId,operationId,fence,{root,env,mustExist:true});
 if(composition.inputHash!==inputs.inputHash||composition.deliveryEligible!==false||composition.qualityStatus!=='semantic_not_checked')throw Error('CONTENT_BASELINE_CHANGED');
 const compositionHash=canonicalHash(composition),filmSha256=composition.movie.technicalQa.sha256,{frozen}=inputs;
 if(composition.postMix.filmSha256!==filmSha256)throw Error('CONTENT_BASELINE_CHANGED');
 const rawEvidence=(await projects.store.readFresh<Awaited<ReturnType<typeof prepareApprovedVisualEvidence>>['record']>(prefix+'visual-evidence-v1-stage')).value,plan=frozen.deliveryPolicy.schemaVersion===2?mvpFilmVisualPlan(frozen.timeline,frozen.deliveryPolicy.visualSampling||'legacy'):wholeFilmVisualPlan(frozen.timeline);
 if(rawEvidence.inputHash!==inputs.inputHash||rawEvidence.compositionHash!==compositionHash||rawEvidence.deliveryEligible!==false||canonicalHash(rawEvidence.plan)!==canonicalHash(plan))throw Error('CONTENT_BASELINE_CHANGED');
 const expected=plan.rounds.flatMap(r=>r.batches.map(b=>({round:r.round,...b})));
 if(rawEvidence.batches.length!==expected.length)throw Error('CONTENT_COVERAGE_MISSING');
 const transcripts:ContentReviewContext['transcripts']=[];
 if(frozen.timeline.narration.length){
  if(composition.postMix.status!=='pass'||composition.postMix.lines.length!==frozen.timeline.narration.length||new Set(composition.postMix.lines.map(l=>l.lineId)).size!==frozen.timeline.narration.length)throw Error('CONTENT_BASELINE_CHANGED');
  for(const clock of frozen.timeline.narration){
   const line=composition.postMix.lines.find(l=>l.lineId===clock.lineId);if(!line)throw Error('CONTENT_BASELINE_CHANGED');
   let spokenTextEvidence:ContentReviewContext['transcripts'][number]['spokenTextEvidence'];
   if(frozen.deliveryPolicy.schemaVersion===2&&frozen.deliveryPolicy.contentNarration==='mandarin_pronunciation_v1'&&line.status==='pass'){
    const entry=frozen.audioManifest.sources.find(s=>s.id==='voice-'+line.lineId);if(!entry)throw Error('CONTENT_BASELINE_CHANGED');
    const packaged=await loadPackagedNarration(projects.store,root,projectId,inputs.bundle.revisionId,entry.sourceRef);
    if(packaged.source.lineId!==line.lineId)throw Error('CONTENT_BASELINE_CHANGED');
    if(packaged.words.recognitionPolicy==='mandarin_pronunciation_v1'&&supportsContentPronunciationEvidence(packaged.source.expectedAsrText,line.recognizedText))spokenTextEvidence={policy:packaged.words.recognitionPolicy,expectedText:packaged.source.expectedAsrText,sourceRef:entry.sourceRef};
   }
   transcripts.push({id:line.lineId,startSample:clock.startSample,endSample:clock.endSample,audioSha256:line.sourceSha256,text:line.recognizedText,verification:line.status,...(spokenTextEvidence?{spokenTextEvidence}:{})});
  }
 }else if(composition.postMix.lines.length)throw Error('CONTENT_BASELINE_CHANGED');
 const requirementsRecord=frozen.facts.schemaVersion===2&&frozen.contentRequirements?{schemaVersion:2,inputHash:inputs.inputHash,factsRef:frozen.filmSpec.factsRef,policy:'independently_audited_source' as const,sourceProofRef:frozen.facts.contentRequirementsRef,requirements:frozen.contentRequirements.requirements}:{schemaVersion:1,inputHash:inputs.inputHash,factsRef:frozen.filmSpec.factsRef,policy:'unclassified_facts_literal' as const,requirements:frozen.facts.facts.map(f=>({factId:f.id,representation:'literal' as const,exactText:[f.text]}))},requirementsRef=immutableRef(prefix+'content-requirements',requirementsRecord);
 if(previous!==undefined&&(!previous||typeof previous!=='object'||!('schemaVersion' in previous)||(previous.schemaVersion!==1&&previous.schemaVersion!==2)))throw Error('CONTENT_BASELINE_CHANGED');
 const completeRounds=previous!==undefined?(previous as {schemaVersion:number}).schemaVersion===2:frozen.deliveryPolicy.schemaVersion===2&&frozen.deliveryPolicy.contentNarration==='mandarin_pronunciation_v1';
 if(completeRounds&&(frozen.deliveryPolicy.schemaVersion!==2||frozen.deliveryPolicy.contentNarration!=='mandarin_pronunciation_v1'))throw Error('CONTENT_BASELINE_CHANGED');
 const prepared:Array<{round:1|2;index:number;evidence:z.infer<typeof VisualEvidenceSchema>;evidenceRef:ObjectRef;context:ContentReviewContext;contextRef:ObjectRef}>=[];
 // Verify complete coverage and all physical PNGs before the first paid call.
 for(const [index,expectedBatch] of expected.entries()){
  const batch=rawEvidence.batches[index],evidence=VisualEvidenceSchema.parse(await readNarrationJson(projects.store,batch.evidenceRef,prefix+'visual-frame-evidence/'));
  if(batch.round!==expectedBatch.round||batch.index!==expectedBatch.index||evidence.filmSha256!==filmSha256||evidence.runtimeDigest!==frozen.filmSpec.runtimeDigest||evidence.width!==frozen.filmSpec.output.width||evidence.height!==frozen.filmSpec.output.height||canonicalHash(evidence.frames.map(f=>f.frame))!==canonicalHash(expectedBatch.frames))throw Error('CONTENT_COVERAGE_MISSING');
  await (options.readImages||readVisualEvidence)(root,evidence);await assertApprovedRenderFence(projects,inputs);
  const context=contentReviewContext({filmSha256,filmSpecSha256:inputs.bundle.filmSpecRef.sha256,factsManifestSha256:frozen.filmSpec.factsRef.sha256,...(frozen.facts.schemaVersion===2?{contentRequirementsRef:frozen.facts.contentRequirementsRef}:{}),fps:frozen.timeline.fps,totalFrames:frozen.timeline.totalFrames,facts:frozen.facts.facts,requirements:requirementsRecord.requirements,frames:evidence.frames.map(({id,frame,sha256,bytes})=>({id,frame,sha256,bytes})),transcripts,reviewBatch:{round:batch.round,index:batch.index}}),contextRef=immutableRef(prefix+'content-context',context);
  prepared.push({round:batch.round,index:batch.index,evidence,evidenceRef:batch.evidenceRef,context,contextRef});
 }
 await assertApprovedRenderFence(projects,inputs);
 if(readOnly)await readNarrationJson(projects.store,requirementsRef,prefix+'content-requirements/');
 else await projects.index.immutable(prefix+'content-requirements',requirementsRecord);
 const groups=completeRounds?([1,2] as const).map(round=>{
  const peers=prepared.filter(p=>p.round===round);if(!peers.length)throw Error('CONTENT_COVERAGE_MISSING');
  const {contextSha256,...base}=peers[0].context;void contextSha256;
  const frames=peers.flatMap(p=>p.context.frames).sort((a,b)=>a.frame-b.frame);
  if(new Set(frames.map(f=>f.id)).size!==frames.length)throw Error('CONTENT_COVERAGE_MISSING');
  const context=contentReviewContext({...base,frames,imageEncoding:'lossless_webp',reviewBatch:{round,index:0}});
  return{...peers[0],index:0,context,contextRef:immutableRef(prefix+'content-context',context),peers};
 }):prepared.map(item=>({...item,peers:[item]}));
 const reviews:Array<{round:1|2;review:ContentReview}>=[],batches:z.infer<typeof BatchSchema>[]=[];
 for(const item of groups){
  await assertApprovedRenderFence(projects,inputs);
  const evidenceIdentity=completeRounds?{evidenceRefs:item.peers.map(p=>p.evidenceRef)}:{evidenceRef:item.evidenceRef};
  const stageKey=canonicalHash({round:item.round,index:item.index,inputHash:inputs.inputHash,compositionHash,requirementsRef,contextRef:item.contextRef,...evidenceIdentity}),batchKey=prefix+'content-review-batches-v1/'+stageKey;
  let saved:z.infer<typeof BatchSchema>|undefined;
  try{saved=BatchSchema.parse((await projects.store.readFresh(batchKey)).value)}catch(error){if(!(error instanceof StoreMissing))throw error}
  let review:ContentReview;
  if(saved){
   if(saved.round!==item.round||saved.index!==item.index||saved.inputHash!==inputs.inputHash||saved.compositionHash!==compositionHash||canonicalHash(saved.requirementsRef)!==canonicalHash(requirementsRef)||canonicalHash(saved.contextRef)!==canonicalHash(item.contextRef)||saved.schemaVersion!==(completeRounds?2:1)||canonicalHash(saved.schemaVersion===2?{evidenceRefs:saved.evidenceRefs}:{evidenceRef:saved.evidenceRef})!==canonicalHash(evidenceIdentity))throw Error('CONTENT_BASELINE_CHANGED');
   const cold=await readNarrationJson(projects.store,saved.contextRef,prefix+'content-context/');if(canonicalHash(cold)!==canonicalHash(item.context))throw Error('CONTENT_BASELINE_CHANGED');
   review=guardContentReview(await readNarrationJson(projects.store,saved.reviewRef,prefix+'content-reviews/'),item.context);
  }else{
   if(readOnly)throw Error('CONTENT_REVIEW_MISSING');
   await projects.index.immutable(prefix+'content-context',item.context);
   const images=new Map<string,Uint8Array>();for(const peer of item.peers)for(const [id,data] of await (options.readImages||readVisualEvidence)(root,peer.evidence)){if(images.has(id))throw Error('CONTENT_COVERAGE_MISSING');images.set(id,data)}await assertApprovedRenderFence(projects,inputs);
   let execute:()=>Promise<ContentReview>;
   if(options.decide){const decide=options.decide;execute=()=>decide(item.context,images)}else{
    requireGeneration(readConfiguration(env));
    const reservation=await reserveModelBudget(projects.store,projectId,operationId+'-content-'+stageKey,{inputTokens:Buffer.byteLength(canonicalJson(item.context))+8192+item.context.frames.length*8192,outputTokens:8000},options.limits||modelLimits(env));
    execute=()=>withAccountedModel(projects.store,reservation.reservation,()=>runContentCritic(item.context,images,reservation.maxOutputTokens,env,{assertActive:()=>assertApprovedRenderFence(projects,inputs)}));
   }
   review=guardContentReview(await runEffect(projects.store,`projects/${projectId}/operations/${operationId}/effects/formal-content-critic/${stageKey}`,async()=>{await assertApprovedRenderFence(projects,inputs);return guardContentReview(await execute(),item.context)}),item.context);
   await assertApprovedRenderFence(projects,inputs);for(const peer of item.peers)await (options.readImages||readVisualEvidence)(root,peer.evidence);await assertApprovedRenderFence(projects,inputs);
   const reviewRef=await projects.index.immutable(prefix+'content-reviews',review),candidate=BatchSchema.parse({schemaVersion:completeRounds?2:1,round:item.round,index:item.index,inputHash:inputs.inputHash,compositionHash,requirementsRef,contextRef:item.contextRef,...evidenceIdentity,reviewRef});
   await assertApprovedRenderFence(projects,inputs);saved=await createOrRead(projects.store,batchKey,candidate);if(canonicalHash(saved)!==canonicalHash(candidate))throw Error('CONTENT_BASELINE_CHANGED');
  }
  await assertApprovedRenderFence(projects,inputs);reviews.push({round:item.round,review});batches.push(saved);
 }
 const facts=frozen.facts.facts.map(f=>{const rounds=([1,2] as const).map(round=>{const checks=reviews.filter(r=>r.round===round).map(r=>r.review.facts.find(c=>c.factId===f.id)!.result),result:Result=checks.includes('fail')?'fail':checks.includes('pass')?'pass':'not_checked';return{round,result}});return{factId:f.id,result:combine(rounds.map(r=>r.result)),rounds}}),conflicts=reviews.flatMap(r=>r.review.conflicts.map(c=>({round:r.round,...c}))),report={schemaVersion:1,filmSha256,filmSpecSha256:inputs.bundle.filmSpecRef.sha256,factsManifestSha256:frozen.filmSpec.factsRef.sha256,scope:'two_round_provided_frames_and_verified_transcripts' as const,result:conflicts.length?'fail' as const:combine(facts.map(f=>f.result)),facts,conflicts,batchCount:batches.length,audio:'transcripts_only' as const,continuousMotion:'not_supplied' as const,deliveryEligible:false as const};
 for(const item of prepared)await (options.readImages||readVisualEvidence)(root,item.evidence);
 const latest=await (options.compose||composeApprovedFilm)(verifier,owner,projectId,operationId,fence,{root,env,mustExist:true});if(canonicalHash(latest)!==compositionHash)throw Error('CONTENT_BASELINE_CHANGED');
 const latestInputs=await loadApprovedRenderInputs(projects,owner,projectId,operationId,fence,{root,env});if(latestInputs.inputHash!==inputs.inputHash)throw Error('RENDER_FENCED');
 await assertApprovedRenderFence(projects,inputs);
 const candidate={schemaVersion:completeRounds?2 as const:1 as const,inputHash:inputs.inputHash,compositionHash,evidenceHash:canonicalHash(rawEvidence),requirementsRef,batches,report,deliveryEligible:false as const};
 if(previous!==undefined){if(canonicalHash(previous)!==canonicalHash(candidate))throw Error('CONTENT_BASELINE_CHANGED');return candidate}
 const saved=await createOrRead(projects.store,key,candidate);if(canonicalHash(saved)!==canonicalHash(candidate))throw Error('CONTENT_BASELINE_CHANGED');await assertApprovedRenderFence(projects,inputs);return candidate;
}
