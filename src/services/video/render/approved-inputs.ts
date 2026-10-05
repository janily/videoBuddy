import {z} from 'zod';
import type {ProjectStore} from '@/services/video/storage/project-store';
import type {ProjectControl} from '@/contracts/video/project';
import type {ApprovalRecord} from '@/services/video/preview/approve';
import {readPreviewBundle} from '@/services/video/preview/commit';
import {verifyPreviewPackage} from '@/services/video/preview/package';
import {readNarrationJson} from '@/services/video/audio/narration-package';
import {SourceCodeSchema} from '@/contracts/video/film-package';
import {computeStageKey,dockerConfiguration} from '@/services/video/media/docker-executor';
import {validateSource,type MediaJob} from '@/services/video/media/executor';
import type {Environment} from '@/services/video/config/environment';
import {canonicalHash} from '@/services/video/domain/hash';
import {CompleteVisualShotSchema} from '@/contracts/video/visual-shot';
import {selectedRuntimeAssets} from '@/services/video/media/runtime-assets';

export type ApprovedRenderInputs=Awaited<ReturnType<typeof loadApprovedRenderInputs>>;
type RenderOperation={id:string;projectId:string;commandId:string;kind:string;status:string;fence:number;approvalId:string;bundleHash:string;consentEpoch:number};
export async function assertApprovedRenderFence(projects:ProjectStore,inputs:ApprovedRenderInputs){
 const {projectId,owner,operationId,expectedFence,approval,frozen}=inputs,prefix=`projects/${projectId}`;
 const c=await projects.access(owner,projectId);
 const op=(await projects.store.readFresh<RenderOperation>(prefix+'/operations/'+operationId)).value;
 const saved=(await projects.store.readFresh<ApprovalRecord>(prefix+'/approvals/'+approval.approvalId)).value;
 assertFence(c,op,saved,{projectId,owner,operationId,expectedFence,approval,understandingHash:canonicalHash(frozen.filmSpec.understandingRef)});
}
function assertFence(c:ProjectControl,op:RenderOperation,saved:ApprovalRecord,input:{projectId:string;owner:string;operationId:string;expectedFence:number;approval:ApprovalRecord;understandingHash:string}){
 const {projectId,owner,operationId,expectedFence,approval,understandingHash}=input;
 if(c.phase!=='rendering'||c.inputPending||c.activeProduction!==operationId||c.currentApprovalId!==approval.approvalId||c.currentPreviewId!==approval.previewId||c.briefVersion!==approval.briefVersion||c.consentEpoch!==approval.consentEpoch||canonicalHash(c.understandingRef)!==understandingHash||
  op.id!==operationId||op.projectId!==projectId||op.kind!=='render'||op.status!=='running'||op.fence!==expectedFence||op.commandId!==approval.clientCommandId||op.approvalId!==approval.approvalId||op.bundleHash!==approval.bundleHash||op.consentEpoch!==approval.consentEpoch||
  saved.projectId!==projectId||saved.ownerKeyHash!==owner||saved.source!=='preview_button'||canonicalHash(saved)!==canonicalHash(approval))throw Error('RENDER_FENCED');
}
export async function loadApprovedRenderInputs(projects:ProjectStore,owner:string,projectId:string,operationId:string,expectedFence:number,options:{root:string;env?:Environment}){
 if(!z.uuid().safeParse(projectId).success||!z.uuid().safeParse(operationId).success||!Number.isSafeInteger(expectedFence)||expectedFence<0)throw Error('VALIDATION_FAILED');
 const config=dockerConfiguration(options.env||process.env,operationId),prefix=`projects/${projectId}`;
 const c=await projects.access(owner,projectId);
 if(!c.currentApprovalId||!c.currentPreviewId)throw Error('RENDER_FENCED');
 const approval=(await projects.store.readFresh<ApprovalRecord>(prefix+'/approvals/'+c.currentApprovalId)).value;
 const op=(await projects.store.readFresh<RenderOperation>(prefix+'/operations/'+operationId)).value;
 const bundle=await readPreviewBundle(projects,projectId,c.currentPreviewId,options.root);
 const frozen=await verifyPreviewPackage(projects,projectId,bundle,options.root);
 if(approval.approvalId!==c.currentApprovalId||approval.previewId!==bundle.previewId||approval.revisionId!==bundle.revisionId||approval.bundleHash!==bundle.bundleHash||approval.scriptHash!==bundle.scriptHash||approval.factsHash!==bundle.factsHash||approval.briefVersion!==bundle.briefVersion||config.runtimeDigest!==frozen.filmSpec.runtimeDigest)throw Error('RENDER_FENCED');
 assertFence(c,op,approval,{projectId,owner,operationId,expectedFence,approval,understandingHash:canonicalHash(frozen.filmSpec.understandingRef)});
 const jobs:MediaJob[]=[];
 for(const shot of frozen.timeline.shots){
  const sourceModule=frozen.sourceManifest.modules.find(entry=>entry.id===shot.sourceModule);if(!sourceModule)throw Error('FILM_VISUAL_SOURCE_CHANGED');
  const code=SourceCodeSchema.parse(await readNarrationJson(projects.store,sourceModule.sourceRef,`${prefix}/revisions/${bundle.revisionId}/`));
  validateSource(code.html);
  const visual=CompleteVisualShotSchema.parse(await readNarrationJson(projects.store,code.visualSourceRef,`${prefix}/revisions/${bundle.revisionId}/visual-source/`));
  const assets=selectedRuntimeAssets(projectId,visual.assetIds,frozen.assetManifest.assets);
  const {width,height,fps}=frozen.filmSpec.output;
  const parameters={projectId,bundleHash:bundle.bundleHash,runtimeDigest:config.runtimeDigest,sourceHtml:code.html,logicalWidth:width,logicalHeight:height,outputWidth:width,outputHeight:height,fps,startFrame:shot.startFrame,endFrame:shot.endFrame,seed:frozen.filmSpec.seed,fence:approval.consentEpoch,...(assets.length?{assets}:{})};
  jobs.push({...parameters,operationId,attemptId:'approved-'+canonicalHash({shotId:shot.id}).slice(0,12),stageKey:computeStageKey(parameters)});
 }
 const inputs={projectId,owner,operationId,expectedFence,approval,bundle,frozen,jobs,inputHash:canonicalHash({approval,bundleHash:bundle.bundleHash,filmSpecRef:bundle.filmSpecRef,jobs})};
 await assertApprovedRenderFence(projects,inputs);return inputs;
}
