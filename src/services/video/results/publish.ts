import{z}from 'zod';
import{canonicalHash}from '@/services/video/domain/hash';
import{assertPublishable}from '@/services/video/quality/publish-gate';
import{validateNewDelivery,DeliveryPolicySchema}from '@/services/video/quality/delivery';
import{verifyMvpPublication}from'@/services/video/render/mvp-publication';
import{reviewApprovedContent}from '@/services/video/render/content-review';
import type{Environment}from '@/services/video/config/environment';
import{inspectArtifact}from '@/services/video/exports/access';
import{actualArtifactSha256}from '@/services/video/exports/verified-file';
import{readPreviewBundle}from '@/services/video/preview/commit';
import type{ApprovalRecord}from '@/services/video/preview/approve';
import{createOrRead,updateJson}from '@/services/video/storage/atomic-store';
import type{ProjectStore}from '@/services/video/storage/project-store';
import type{ProjectControl}from '@/contracts/video/project';

const Id=z.string().uuid(),Digest=z.string().regex(/^[a-f0-9]{64}$/);
const Check=z.strictObject({ruleId:z.string().min(1),result:z.enum(['pass','fail','not_checked','not_applicable','waived']),severity:z.enum(['blocking','warning']),evidenceRefs:z.array(z.string().min(1)),reason:z.string().optional(),waiverActor:z.string().optional()});
const Manifest=z.strictObject({resultId:Id,artifactId:Id,revisionId:Id,previewId:Id,approvalId:Id,bundleHash:Digest,mp4Sha256:Digest,mp4Bytes:z.number().int().positive(),qualityPolicy:DeliveryPolicySchema,qualityChecks:z.array(Check),createdAt:z.string().datetime({offset:true})});
export type ResultManifest=z.input<typeof Manifest>;
function key(projectId:string,resultId:string){return`projects/${projectId}/results/${resultId}/manifest`}
export async function readResultManifest(projects:ProjectStore,projectId:string,resultId:string){
 const result=Manifest.parse((await projects.store.readFresh<unknown>(key(projectId,resultId))).value);
 if(result.resultId!==resultId)throw Error('RESULT_INVALID');return result;
}
type PublishOptions={env?:Environment;verifyContent?:typeof reviewApprovedContent};
export async function publishResult(projects:ProjectStore,owner:string,projectId:string,operationId:string,expectedFence:number,untrusted:ResultManifest,storageRoot:string,options:PublishOptions={}){
 const parsed=Manifest.safeParse(untrusted);if(!parsed.success)throw Error('RESULT_INVALID');const result=parsed.data,p=`projects/${projectId}`;
 await projects.access(owner,projectId);
 const approval=(await projects.store.readFresh<ApprovalRecord>(`${p}/approvals/${result.approvalId}`)).value;
 const preview=await readPreviewBundle(projects,projectId,result.previewId);
 if(approval.projectId!==projectId||approval.ownerKeyHash!==owner||approval.source!=='preview_button'||approval.approvalId!==result.approvalId||approval.previewId!==result.previewId||approval.revisionId!==result.revisionId||approval.bundleHash!==result.bundleHash||preview.bundleHash!==result.bundleHash||preview.revisionId!==result.revisionId||canonicalHash(result.qualityPolicy)!==preview.renderInputs.qualityPolicySha256)throw Error('PREVIEW_STALE');
 const artifact=await inspectArtifact(projects,owner,projectId,result.artifactId);
 if(artifact.revisionId!==result.revisionId||artifact.objectRef.sha256!==result.mp4Sha256||artifact.objectRef.bytes!==result.mp4Bytes||artifact.objectRef.mime!=='video/mp4')throw Error('ARTIFACT_INVALID');
 const actualFileSha256=await actualArtifactSha256(storageRoot,artifact.objectRef.key,result.mp4Bytes);
 validateNewDelivery({policy:result.qualityPolicy,expectedPolicySha256:preview.renderInputs.qualityPolicySha256,expectedFileSha256:result.mp4Sha256,actualFileSha256,checks:result.qualityChecks});
 if(!Number.isSafeInteger(expectedFence)||expectedFence<0)throw Error('PUBLISH_FENCED');
 const operationKey=`${p}/operations/${operationId}`;
 const operation=(await projects.store.readFresh<{status:string;fence:number;approvalId:string;bundleHash:string;consentEpoch:number}>(operationKey)).value;
 if(operation.status!=='running'||operation.fence!==expectedFence||operation.approvalId!==approval.approvalId||operation.bundleHash!==result.bundleHash||operation.consentEpoch!==approval.consentEpoch)throw Error('PUBLISH_FENCED');
 const control=await projects.access(owner,projectId);
 if(control.currentResultId===result.resultId){
  if(canonicalHash(await readResultManifest(projects,projectId,result.resultId))!==canonicalHash(result)||canonicalHash(control.renderOutcomes?.[operationId])!==canonicalHash({status:'succeeded',resultId:result.resultId,resultHash:canonicalHash(result)}))throw Error('PUBLISH_FENCED');
  return projects.view(owner,projectId);
 }
 // A passing row alone is insufficient: replay the owned immutable stage,
 // including the actual frozen composition and every sampled image, read-only.
 const content=await(options.verifyContent||reviewApprovedContent)(projects,owner,projectId,operationId,expectedFence,{root:storageRoot,env:options.env,mustExist:true});
 const contentRef=`${p}/approvals/${approval.approvalId}/content-review-v1-stage`,check=result.qualityChecks.find(c=>c.ruleId==='content_coverage');
 if(content.report.result!=='pass'||content.report.filmSha256!==actualFileSha256||content.report.filmSpecSha256!==preview.filmSpecRef.sha256||content.report.scope!=='two_round_provided_frames_and_verified_transcripts'||content.deliveryEligible!==false||!check||canonicalHash(check.evidenceRefs)!==canonicalHash([contentRef]))throw Error('QUALITY_BLOCKED');
 if(result.qualityPolicy.schemaVersion===2)await verifyMvpPublication(projects,owner,projectId,operationId,expectedFence,result,{root:storageRoot,env:options.env});
 const stored=await createOrRead(projects.store,key(projectId,result.resultId),result);
 if(canonicalHash(stored)!==canonicalHash(result))throw Error('RESULT_ID_CONFLICT');
 await updateJson(projects.store,`${p}/control`,async(control:ProjectControl)=>{
  const outcome={status:'succeeded' as const,resultId:result.resultId,resultHash:canonicalHash(result)};
  if(control.renderOutcomes?.[operationId]&&canonicalHash(control.renderOutcomes[operationId])!==canonicalHash(outcome))throw Error('PUBLISH_FENCED');
  if(control.currentResultId===result.resultId)return control;
  const latest=(await projects.store.readFresh<typeof operation>(operationKey)).value;
  if(latest.status!=='running'||latest.fence!==expectedFence)throw Error('PUBLISH_FENCED');
  assertPublishable({bundleHash:preview.bundleHash,consentEpoch:control.consentEpoch,owner:control.ownerKeyHash,activeOperationId:control.activeProduction||'',deletedAt:control.deletedAt},{bundleHash:approval.bundleHash,consentEpoch:approval.consentEpoch,owner:approval.ownerKeyHash,operationId});
  if(control.phase!=='rendering'||control.currentApprovalId!==approval.approvalId||control.currentPreviewId!==preview.previewId||control.briefVersion!==approval.briefVersion)throw Error('PUBLISH_FENCED');
  if(Object.keys(control.renderOutcomes||{}).length>=16)throw Error('RECOVERY_REQUIRED');
  return{...control,controlVersion:control.controlVersion+1,phase:'ready' as const,previousResultId:control.currentResultId,currentResultId:result.resultId,activeProduction:null,renderOutcomes:{...control.renderOutcomes,[operationId]:outcome},latestRenderOutcome:{operationId,briefVersion:approval.briefVersion,consentEpoch:approval.consentEpoch,controlVersion:control.controlVersion+1}};
 });
 return projects.view(owner,projectId);
}
