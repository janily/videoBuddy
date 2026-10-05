import {readFile} from 'node:fs/promises';
import {FileStore} from '../../src/services/video/storage/file-store';
import {canonicalHash} from '../../src/services/video/domain/hash';
import {readNarrationJson} from '../../src/services/video/audio/narration-package';
import {loadVerifiedFilmPackage} from '../../src/contracts/video/film-package';
import {requirementsContext,guardRequirementsProposal} from '../../src/contracts/video/content-requirements';
import {claimProbeReport,persistProbeReport} from './helpers/probe-report';
async function main(){
 if(process.argv.slice(2).join(' ')!=='--verify-source-floors')throw Error('SOURCE_REQUIREMENTS_FLAG_REQUIRED');
 const technical=JSON.parse(await readFile('docs/engineering/evidence/clear-full-film-technical-probe.json','utf8')),critic=JSON.parse(await readFile('docs/engineering/evidence/clear-full-film-critic-probe.json','utf8')),published=JSON.parse(await readFile('docs/engineering/evidence/clear-frozen-preview-continuation-probe.json','utf8'));
 if(technical.status!=='actual_clear_1080p_composition_postmix_and_two_round_frames_verified')throw Error('SOURCE_REQUIREMENTS_BASELINE_REQUIRED');
 const store=new FileStore(technical.sourceRoot),prefix=`projects/${technical.projectId}/`,keys=[prefix+'control',prefix+'budget',prefix+'operations/'+technical.sourceOperationId,prefix+'operations/'+published.sourceOperationId],journal=prefix+'operations/'+technical.journalOperationId+'/media-effects';
 async function inventory(){return canonicalHash({state:await Promise.all(keys.map(async key=>(await store.readFresh(key)).value)),native:await Promise.all((await store.listKeys(journal,1)).map(async key=>({key,value:(await store.readFresh(key)).value})))})}
 const unknownStore=new FileStore(critic.root);async function unknown(){return canonicalHash(await Promise.all(['budgets/model-gate',`projects/${critic.diagnosticProjectId}/budget`].map(async key=>({key,value:(await unknownStore.readFresh(key)).value}))))}
 const before=await inventory(),unknownBefore=await unknown(),path='docs/engineering/evidence/source-requirements-floor-probe.json',report:Record<string,unknown>={executedAt:new Date().toISOString(),status:'started',sourceRoot:technical.sourceRoot,sourceProjectId:technical.projectId,revisionId:technical.bundle.revisionId,modelCalls:0,nativeCalls:0,auditorRun:false,sourceClassificationApproved:false,formalProductionApproval:false,resultPublished:false,deliveryEligible:false};await claimProbeReport(path,report);
 let networkCalls=0;const saved=globalThis.fetch;globalThis.fetch=async()=>{networkCalls++;throw Error('SOURCE_REQUIREMENTS_NETWORK_FORBIDDEN')};
 try{
  const p=prefix+`revisions/${technical.bundle.revisionId}/`,spec=await readNarrationJson(store,technical.bundle.filmSpecRef,p+'film/'),frozen=await loadVerifiedFilmPackage(store,spec,technical.sourceRoot),context=requirementsContext({understandingSha256:frozen.filmSpec.understandingRef.sha256,facts:frozen.facts.facts});
  const candidate=(kind:'semantic'|'literal')=>({schemaVersion:1,contextSha256:context.contextSha256,facts:context.facts.map(f=>({factId:f.id,segments:[{sourceText:f.text,kind,reason:'Mechanical negative-control candidate only; no model or auditor opinion.'}]}))});
  let rejection:string|undefined;try{guardRequirementsProposal(candidate('semantic'),context)}catch(error){rejection=(error as Error).message}
  if(rejection!=='CONTENT_REQUIREMENTS_LITERAL_MISSING')throw Error('SOURCE_REQUIREMENTS_FLOOR_NOT_ENFORCED');
  const literal=guardRequirementsProposal(candidate('literal'),context);
  Object.assign(report,{status:'actual_complete_source_literal_floor_verified_no_audit',filmSpecRef:technical.bundle.filmSpecRef,understandingRef:frozen.filmSpec.understandingRef,factsRef:frozen.filmSpec.factsRef,completeFacts:context.facts.length,contextSha256:context.contextSha256,fullSourceText:context.facts.map(f=>({factId:f.id,text:f.text})),unsafeWholeSemanticRejection:rejection,conservativeCandidateValid:literal.facts.length===context.facts.length});
 }catch(error){Object.assign(report,{status:'failed',errorCode:(error as Error).message});process.exitCode=1}
 finally{globalThis.fetch=saved;Object.assign(report,{networkCalls,originalStateAndNativeUnchanged:before===await inventory(),unknownBudgetGateUnchanged:unknownBefore===await unknown()});if(networkCalls||!report.originalStateAndNativeUnchanged||!report.unknownBudgetGateUnchanged){Object.assign(report,{status:'failed',errorCode:'SOURCE_REQUIREMENTS_STATE_CHANGED'});process.exitCode=1}await persistProbeReport(path,report);console.log(JSON.stringify({status:report.status,errorCode:report.errorCode,completeFacts:report.completeFacts,networkCalls,originalStateAndNativeUnchanged:report.originalStateAndNativeUnchanged,unknownBudgetGateUnchanged:report.unknownBudgetGateUnchanged}))}
}
main().catch(error=>{console.error(error.message);process.exitCode=1});
