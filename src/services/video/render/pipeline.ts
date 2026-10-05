import type {ProjectStore} from '@/services/video/storage/project-store';
import type {Environment} from '@/services/video/config/environment';
import type {ResultManifest} from '@/services/video/results/publish';
import {prepareMvpCoreEvidence} from './mvp-core';
import {compileApprovedDeliveryChecks} from '@/services/video/quality/approved-delivery';
import {canonicalHash} from '@/services/video/domain/hash';
import {createOrRead} from '@/services/video/storage/atomic-store';
import {composeApprovedFilm} from './composition';
import {reviewApprovedContent} from './content-review';
import {reviewApprovedWholeFilm} from './visual-review';
import {assertApprovedRenderFence,loadApprovedRenderInputs} from './approved-inputs';
import {readConfiguration,requireGeneration} from '@/services/video/config/environment';
import {configuredModel} from '@/mastra/video/model-adapter';

export interface RenderTargets{resultId:string;artifactId:string;createdAt:string}
/** Runs frozen producers and the real Critic. Missing full-motion/listening/rights
 * evidence stays not_checked; the consumer must validateDelivery before copying. */
export async function renderApproved(projects:ProjectStore,owner:string,projectId:string,operationId:string,fence:number,targets:RenderTargets,options:{root:string;env?:Environment;mustExist?:boolean},activity:(stage:string,label:string)=>Promise<void>):Promise<{result:ResultManifest;outputPath:string}>{
 const env=options.env||process.env;requireGeneration(readConfiguration(env));configuredModel('critic',env);
 const inputs=await loadApprovedRenderInputs(projects,owner,projectId,operationId,fence,options),prefix=`projects/${projectId}/approvals/${inputs.approval.approvalId}/`;
 await activity('composition','正在制作完整画面和声音');
 if(options.mustExist)await projects.store.readFresh(prefix+'delivery-qa-v2-stage');
 const composition=await composeApprovedFilm(projects,owner,projectId,operationId,fence,options);
 await assertApprovedRenderFence(projects,inputs);
 await activity('critic','正在分两轮检查完整画面');
 const visual=await reviewApprovedWholeFilm(projects,owner,projectId,operationId,fence,{...options,mustExist:Boolean(options.mustExist)});
 await assertApprovedRenderFence(projects,inputs);
 await activity('content','正在核对完整影片里的内容');
 const content=await reviewApprovedContent(projects,owner,projectId,operationId,fence,options);
 await assertApprovedRenderFence(projects,inputs);
 if(content.inputHash!==inputs.inputHash||content.compositionHash!==canonicalHash(composition)||content.report.filmSpecSha256!==inputs.bundle.filmSpecRef.sha256||content.report.factsManifestSha256!==inputs.frozen.filmSpec.factsRef.sha256)throw Error('RENDER_OUTPUT_CHANGED');
 const policy=inputs.frozen.deliveryPolicy,qa=composition.movie.technicalQa;
 if(composition.inputHash!==inputs.inputHash||visual.inputHash!==inputs.inputHash||visual.report.filmSha256!==qa.sha256)throw Error('RENDER_OUTPUT_CHANGED');
 const technicalRef=prefix+'composite-v2-stage',visualRef=prefix+'whole-visual-review-v1-stage';
 const core=policy.schemaVersion===2?await prepareMvpCoreEvidence(projects,owner,projectId,operationId,fence,qa.sha256,options):undefined;
 const checks=compileApprovedDeliveryChecks(policy,composition,visual.report,technicalRef,visualRef,{report:content.report,ref:prefix+'content-review-v1-stage'},core);
 const result:ResultManifest={...targets,revisionId:inputs.bundle.revisionId,previewId:inputs.bundle.previewId,approvalId:inputs.approval.approvalId,bundleHash:inputs.bundle.bundleHash,mp4Sha256:qa.sha256,mp4Bytes:qa.bytes,qualityPolicy:policy,qualityChecks:checks};
 const report={schemaVersion:2,inputHash:inputs.inputHash,compositionHash:canonicalHash(composition),visualHash:canonicalHash(visual),contentHash:canonicalHash(content),result,deliveryEligible:false};
 const saved=await createOrRead(projects.store,prefix+'delivery-qa-v2-stage',report);if(canonicalHash(saved)!==canonicalHash(report))throw Error('RENDER_OUTPUT_CHANGED');
 await assertApprovedRenderFence(projects,inputs);
 return{result,outputPath:composition.movie.outputPath};
}
