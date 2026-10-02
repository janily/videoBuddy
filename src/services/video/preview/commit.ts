import type{ProjectControl}from '@/contracts/video/project';
import{canonicalHash}from '@/services/video/domain/hash';
import type{ProjectStore}from '@/services/video/storage/project-store';
import{createOrRead,updateJson}from '@/services/video/storage/atomic-store';
import{assertPreviewArtifact,verifyPreviewBundle,type PreviewBundle}from './bundle';

function key(projectId:string,previewId:string){return`projects/${projectId}/previews/${previewId}/manifest`}

export async function readPreviewBundle(projects:ProjectStore,projectId:string,previewId:string):Promise<PreviewBundle>{
 const bundle=(await projects.store.readFresh<PreviewBundle>(key(projectId,previewId))).value;
 if(bundle.previewId!==previewId||!verifyPreviewBundle(bundle))throw Error('PREVIEW_BUNDLE_INVALID');
 return bundle;
}

export async function commitPreviewBundle(projects:ProjectStore,projectId:string,operationId:string,expectedConsentEpoch:number,bundle:PreviewBundle,actualArtifactSha256:string){
 assertPreviewArtifact(bundle,actualArtifactSha256);
 if(bundle.expiresAt<=new Date().toISOString())throw Error('PREVIEW_STALE');
 const stored=await createOrRead(projects.store,key(projectId,bundle.previewId),bundle);
 if(canonicalHash(stored)!==canonicalHash(bundle))throw Error('PREVIEW_ID_CONFLICT');
 return updateJson(projects.store,`projects/${projectId}/control`,(control:ProjectControl)=>{
  if(control.deletedAt||Date.parse(control.expiresAt)<=Date.now()||control.phase!=='preparing_preview'||control.activeProduction!==operationId||control.consentEpoch!==expectedConsentEpoch||control.briefVersion!==bundle.briefVersion||control.inputPending)throw Error('PREVIEW_STALE');
  return{...control,controlVersion:control.controlVersion+1,phase:'preview_ready' as const,previewState:'ready' as const,currentPreviewId:bundle.previewId,activeProduction:null};
 });
}
