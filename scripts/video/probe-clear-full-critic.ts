import type {Environment} from '../../src/services/video/config/environment';
import {createHash,randomUUID} from 'node:crypto';
import {readFile,mkdtemp,realpath} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {FileStore} from '../../src/services/video/storage/file-store';
import {ProjectStore} from '../../src/services/video/storage/project-store';
import {canonicalHash,canonicalJson} from '../../src/services/video/domain/hash';
import {readPublishedPreview} from '../../src/services/video/preview/commit';
import {readNarrationJson} from '../../src/services/video/audio/narration-package';
import {loadVerifiedFilmPackage} from '../../src/contracts/video/film-package';
import {type VisualReview,type VisualReviewContext} from '../../src/contracts/video/visual-review';
import {wholeFilmVisualPlan,aggregateWholeVisualReviews} from '../../src/services/video/quality/whole-visual-plan';
import {prepareWholeVisualContexts,type WholeVisualBatch} from '../../src/services/video/quality/whole-visual-contexts';
import {readVisualEvidence} from '../../src/services/video/quality/visual-evidence';
import {requireUnlimitedValidation,authorizeUnlimitedValidation} from '../../src/services/video/budget/validation-authorization';
import {reserveModelBudget,modelLimits} from '../../src/services/video/budget/model-budget';
import {withAccountedModel} from '../../src/services/video/budget/model-call';
import {runVisualCritic} from '../../src/mastra/video/critic';
import {getStyle} from '../../src/services/video/styles/registry';
import {loadStageKnowledge} from '../../src/services/video/styles/knowledge-loader';
import {probeEnvironment,recordModelRequests} from './helpers/real-probe';
import {runAndArchiveProbeReview} from './helpers/probe-critic-review';
import {claimProbeReport,persistProbeReport} from './helpers/probe-report';
async function main(){
 if(process.argv.slice(2).join(' ')!=='--critic-clear-full-two-rounds')throw Error('CLEAR_FULL_CRITIC_FLAG_REQUIRED');
 if(!process.env.MODEL_API_KEY||!process.env.MODEL_BASE_URL)throw Error('CLEAR_FULL_CRITIC_CREDENTIALS_REQUIRED');
 const source=JSON.parse(await readFile('docs/engineering/evidence/clear-full-film-technical-probe.json','utf8'));
 if(source.status!=='actual_clear_1080p_composition_postmix_and_two_round_frames_verified'||source.formalProductionApproval!==false||source.resultPublished!==false)throw Error('CLEAR_FULL_CRITIC_SOURCE_REQUIRED');
 const original=new FileStore(source.sourceRoot),projects=new ProjectStore(original),prefix=`projects/${source.projectId}/`,published=JSON.parse(await readFile('docs/engineering/evidence/clear-frozen-preview-continuation-probe.json','utf8')),keys=[prefix+'control',prefix+'budget',prefix+'operations/'+published.operation.id,prefix+'operations/'+published.sourceOperationId],before=await Promise.all(keys.map(async key=>canonicalHash((await original.readFresh(key)).value))),reportPath='docs/engineering/evidence/clear-full-film-critic-probe.json';
 const report:Record<string,unknown>={executedAt:new Date().toISOString(),status:'preflight',sourceRoot:source.sourceRoot,sourceProjectId:source.projectId,technicalRoot:source.root,sourceProofSha256:canonicalHash(source),formalProductionApproval:false,resultPublished:false,deliveryEligible:false,newNativeExecutions:0};
 await claimProbeReport(reportPath,report);
 async function save(){await persistProbeReport(reportPath,report)}
 async function assertActive(){await projects.access('new-theme-validation',source.projectId);if(canonicalHash(before)!==canonicalHash(await Promise.all(keys.map(async key=>canonicalHash((await original.readFresh(key)).value)))))throw Error('CLEAR_FULL_CRITIC_SOURCE_CHANGED')}
 let transport:ReturnType<typeof recordModelRequests>|undefined;
 try{
  await assertActive();const bundle=await readPublishedPreview(projects,source.projectId,published.operation.id,published.operation.consentEpoch,published.operation.previewId,source.sourceRoot);
  if(canonicalHash(bundle)!==canonicalHash(source.bundle))throw Error('CLEAR_FULL_CRITIC_SOURCE_CHANGED');
  const frozen=await loadVerifiedFilmPackage(original,await readNarrationJson(original,bundle.filmSpecRef,prefix+`revisions/${bundle.revisionId}/film/`),source.sourceRoot),film=source.movie.technicalQa;
  const root=await realpath(source.root);if(root!==source.root||await realpath(source.movie.outputPath)!==source.movie.outputPath||!source.movie.outputPath.startsWith(root+'/composition/'))throw Error('CLEAR_FULL_CRITIC_PATH_CHANGED');
  const bytes=await readFile(source.movie.outputPath);if(bytes.length!==film.bytes||createHash('sha256').update(bytes).digest('hex')!==film.sha256)throw Error('CLEAR_FULL_CRITIC_FILM_CHANGED');
  const style=getStyle(frozen.filmSpec.style.slug),knowledge=await loadStageKnowledge(style.slug,'style'),baseline={filmSha256:film.sha256,filmSpecSha256:bundle.filmSpecRef.sha256,styleSlug:style.slug,styleRulesHash:style.rulesHash,facts:frozen.facts.facts.filter(f=>f.critical||f.mustInclude).map(({id,text})=>({id,text}))},plan=wholeFilmVisualPlan(frozen.timeline),batches:WholeVisualBatch[]=source.visualBatches;
  if(canonicalHash(plan)!==canonicalHash(source.visualPlan))throw Error('WHOLE_VISUAL_PLAN_CHANGED');
  const contexts=prepareWholeVisualContexts(plan,baseline,batches,frozen.filmSpec.runtimeDigest);
  // Check ALL physical PNGs before authorizing even the first paid request.
  for(const batch of batches)await readVisualEvidence(root,batch.evidence);
  await assertActive();const diagnosticRoot=await mkdtemp(resolve('.video-local/clear-full-critic-')),isolated=new ProjectStore(new FileStore(diagnosticRoot)),projectId=randomUUID(),env:Environment={...probeEnvironment(diagnosticRoot),VIDEO_MODEL_BUDGET_MODE:'unlimited_validation',VIDEO_CRITIC_MODEL:'gemini-3.8-flash'};
  await authorizeUnlimitedValidation(isolated.store,await requireUnlimitedValidation(original));
  transport=recordModelRequests(env,diagnosticRoot,contexts.length,{timeoutMs:180000});const entries:Array<{context:VisualReviewContext;review:VisualReview}>=[],calls:Array<Record<string,unknown>>=[];
  report.root=diagnosticRoot;report.diagnosticProjectId=projectId;report.baseline=baseline;report.plan=plan;report.calls=calls;report.requests=transport.requests;report.status='running';await save();
  for(const [index,context] of contexts.entries()){
   await assertActive();const images=await readVisualEvidence(root,batches[index].evidence),stage=`round-${batches[index].round}-batch-${batches[index].index}`,cost={inputTokens:Buffer.byteLength(canonicalJson({context,styleRules:knowledge.rules}))+8192+context.frames.length*8192,outputTokens:16000},reservation=(await reserveModelBudget(isolated.store,projectId,stage,cost,modelLimits(env))).reservation,contextRef=await isolated.index.immutable(`projects/${projectId}/contexts/${stage}`,context),call:Record<string,unknown>={index,stage,reservation,contextRef,status:'reserved'};
   calls.push(call);await save();let review:VisualReview|undefined;
   const outcome=await runAndArchiveProbeReview(()=>withAccountedModel(isolated.store,reservation,()=>runVisualCritic(context,images,cost.outputTokens,env,{assertActive})),value=>isolated.index.immutable(`projects/${projectId}/reviews/${stage}`,value));
   Object.assign(call,outcome);if(outcome.status==='validated'){review=outcome.review;entries.push({context,review})}
   await transport.flush();call.request=transport.requests[index];const budget=(await isolated.store.readFresh<{accounting:Record<string,{state:string;inputTokens?:number;outputTokens?:number}>}>(`projects/${projectId}/budget`)).value;call.actual=budget.accounting[reservation.id];
   const request=transport.requests[index],actual=budget.accounting[reservation.id];
   await save();await assertActive();await readVisualEvidence(root,batches[index].evidence);
   if(transport.requests.length!==index+1||!request?.responseFile||request.status!==200||request.evidenceErrorName||!['settled','overrun'].includes(actual?.state))throw Error('CLEAR_FULL_CRITIC_USAGE_UNCERTAIN');
   const raw=await readFile(join(diagnosticRoot,request.responseFile));if(createHash('sha256').update(raw).digest('hex')!==request.responseSha256)throw Error('CLEAR_FULL_CRITIC_RAW_CHANGED');const usage=JSON.parse(raw.toString()).usage;
   if(usage?.prompt_tokens!==actual.inputTokens||usage?.completion_tokens!==actual.outputTokens)throw Error('CLEAR_FULL_CRITIC_USAGE_CHANGED');
   call.rawUsageMatchesAccounting=true;await save();console.log(JSON.stringify({completed:index+1,total:contexts.length,status:call.status,style:review?.style.result,readability:review?.readability.result,facts:review?.facts.map(f=>f.result)}));
  }
  for(const batch of batches)await readVisualEvidence(root,batch.evidence);
  const finalBytes=await readFile(source.movie.outputPath);if(finalBytes.length!==film.bytes||createHash('sha256').update(finalBytes).digest('hex')!==film.sha256)throw Error('CLEAR_FULL_CRITIC_FILM_CHANGED');
  await assertActive();report.finalMovieAndAllImagesRechecked=true;
  if(entries.length===contexts.length){report.aggregate=aggregateWholeVisualReviews(plan,baseline,entries);report.status='two_round_sampled_critic_complete'}else report.status='two_round_critic_output_blocked';
 }catch(error){report.status='failed';report.errorCode=String((error as Error).message).replaceAll(process.env.MODEL_API_KEY!,'[redacted]').slice(0,200);process.exitCode=1}
 finally{if(transport){await transport.flush();transport.restore()}report.originalControlBudgetOperationsUnchanged=canonicalHash(before)===canonicalHash(await Promise.all(keys.map(async key=>canonicalHash((await original.readFresh(key)).value))));if(!report.originalControlBudgetOperationsUnchanged){report.status='failed';report.errorCode='CLEAR_FULL_CRITIC_SOURCE_CHANGED';process.exitCode=1}await save();console.log(JSON.stringify({status:report.status,errorCode:report.errorCode,aggregate:report.aggregate}))}
}
main().catch(error=>{console.error(String(error.message).replaceAll(process.env.MODEL_API_KEY||'missing-key','[redacted]').slice(0,200));process.exitCode=1});
