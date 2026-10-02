import type{ProjectControl}from '@/contracts/video/project';
import{canonicalHash}from '@/services/video/domain/hash';
import type{ProjectStore}from '@/services/video/storage/project-store';
import{StoreMissing,createOrRead,updateJson}from '@/services/video/storage/atomic-store';
import{inspectArtifact}from '@/services/video/exports/access';
import{actualArtifactSha256}from '@/services/video/exports/verified-file';
import{assertPreviewArtifact,verifyPreviewBundle,type PreviewBundle}from './bundle';
import{verifyPreviewPackage}from './package';

function key(projectId:string,previewId:string){return`projects/${projectId}/previews/${previewId}/manifest`}

export async function readPreviewBundle(projects:ProjectStore,projectId:string,previewId:string):Promise<PreviewBundle>{
 const bundle=(await projects.store.readFresh<PreviewBundle>(key(projectId,previewId))).value;
 if(bundle.previewId!==previewId||!verifyPreviewBundle(bundle))throw Error('PREVIEW_BUNDLE_INVALID');
 await verifyPreviewPackage(projects,projectId,bundle);
 return bundle;
}

export async function commitPreviewBundle(projects:ProjectStore,projectId:string,operationId:string,expectedConsentEpoch:number,bundle:PreviewBundle,storageRoot:string){
 const current=(await projects.store.readFresh<ProjectControl>(`projects/${projectId}/control`)).value;
 const artifact=await inspectArtifact(projects,current.ownerKeyHash,projectId,bundle.previewArtifactId).catch(error=>{if(error instanceof StoreMissing)throw Error('PREVIEW_ARTIFACT_MISMATCH');throw error});
 if(artifact.revisionId!==bundle.revisionId||artifact.objectRef.mime!=='video/mp4'||artifact.objectRef.sha256!==bundle.previewArtifactSha256)throw Error('PREVIEW_ARTIFACT_MISMATCH');
 const actual=await actualArtifactSha256(storageRoot,artifact.objectRef.key,artifact.objectRef.bytes).catch(()=>{throw Error('PREVIEW_ARTIFACT_MISMATCH')});
 assertPreviewArtifact(bundle,actual);
 await verifyPreviewPackage(projects,projectId,bundle);
 if(bundle.expiresAt<=new Date().toISOString())throw Error('PREVIEW_STALE');
 const stored=await createOrRead(projects.store,key(projectId,bundle.previewId),bundle);
 if(canonicalHash(stored)!==canonicalHash(bundle))throw Error('PREVIEW_ID_CONFLICT');
 return updateJson(projects.store,`projects/${projectId}/control`,(control:ProjectControl)=>{
  if(control.deletedAt||Date.parse(control.expiresAt)<=Date.now()||control.phase!=='preparing_preview'||control.activeProduction!==operationId||control.consentEpoch!==expectedConsentEpoch||control.briefVersion!==bundle.briefVersion||control.inputPending)throw Error('PREVIEW_STALE');
  return{...control,controlVersion:control.controlVersion+1,phase:'preview_ready' as const,previewState:'ready' as const,currentPreviewId:bundle.previewId,activeProduction:null};
 });
}
