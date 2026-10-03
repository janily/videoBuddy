import type{ProjectControl}from '@/contracts/video/project';
import{canonicalHash}from '@/services/video/domain/hash';
import type{ProjectStore}from '@/services/video/storage/project-store';
import{StoreMissing,createOrRead,updateJson}from '@/services/video/storage/atomic-store';
import{inspectArtifact}from '@/services/video/exports/access';
import{actualArtifactSha256}from '@/services/video/exports/verified-file';
import{assertPreviewArtifact,verifyPreviewBundle,type PreviewBundle}from './bundle';
import{verifyPreviewPackage}from './package';
import{assertPreviewOperation}from './operation';

function key(projectId:string,previewId:string){return`projects/${projectId}/previews/${previewId}/manifest`}

export async function readPreviewBundle(projects:ProjectStore,projectId:string,previewId:string,storageRoot?:string):Promise<PreviewBundle>{
 const bundle=(await projects.store.readFresh<PreviewBundle>(key(projectId,previewId))).value;
 if(bundle.previewId!==previewId||!verifyPreviewBundle(bundle))throw Error('PREVIEW_BUNDLE_INVALID');
 await verifyPreviewPackage(projects,projectId,bundle,storageRoot);
 return bundle;
}

export async function readPublishedPreview(projects:ProjectStore,projectId:string,operationId:string,consentEpoch:number,previewId:string,storageRoot:string){
 const c=(await projects.store.readFresh<ProjectControl>(`projects/${projectId}/control`)).value;
 const bundle=await readPreviewBundle(projects,projectId,previewId,storageRoot);
 if(c.deletedAt||Date.parse(c.expiresAt)<=Date.now()||c.currentPreviewId!==previewId||c.consentEpoch!==consentEpoch||c.briefVersion!==bundle.briefVersion)throw Error('PREVIEW_STALE');
 await assertPreviewOperation(projects,c,operationId,bundle.revisionId,previewId,consentEpoch);
 const saved=(await projects.store.readFresh(`projects/${projectId}/previews/${previewId}/publication`)).value;
 if(canonicalHash(saved)!==canonicalHash({operationId,expectedConsentEpoch:consentEpoch,bundleSha256:canonicalHash(bundle)}))throw Error('PREVIEW_STALE');
 const artifact=await inspectArtifact(projects,c.ownerKeyHash,projectId,bundle.previewArtifactId);
 if(artifact.revisionId!==bundle.revisionId||artifact.objectRef.mime!=='video/mp4'||artifact.objectRef.sha256!==bundle.previewArtifactSha256)throw Error('PREVIEW_ARTIFACT_MISMATCH');
 const actual=await actualArtifactSha256(storageRoot,artifact.objectRef.key,artifact.objectRef.bytes).catch(()=>{throw Error('PREVIEW_ARTIFACT_MISMATCH')});
 assertPreviewArtifact(bundle,actual);return bundle;
}

export async function commitPreviewBundle(projects:ProjectStore,projectId:string,operationId:string,expectedConsentEpoch:number,bundle:PreviewBundle,storageRoot:string){
 const current=(await projects.store.readFresh<ProjectControl>(`projects/${projectId}/control`)).value;
 const artifact=await inspectArtifact(projects,current.ownerKeyHash,projectId,bundle.previewArtifactId).catch(error=>{if(error instanceof StoreMissing)throw Error('PREVIEW_ARTIFACT_MISMATCH');throw error});
 if(artifact.revisionId!==bundle.revisionId||artifact.objectRef.mime!=='video/mp4'||artifact.objectRef.sha256!==bundle.previewArtifactSha256)throw Error('PREVIEW_ARTIFACT_MISMATCH');
 const actual=await actualArtifactSha256(storageRoot,artifact.objectRef.key,artifact.objectRef.bytes).catch(()=>{throw Error('PREVIEW_ARTIFACT_MISMATCH')});
 assertPreviewArtifact(bundle,actual);
 const verified=await verifyPreviewPackage(projects,projectId,bundle,storageRoot);
 if(current.deletedAt||Date.parse(current.expiresAt)<=Date.now()||current.inputPending||current.briefVersion!==bundle.briefVersion||current.consentEpoch!==expectedConsentEpoch)throw Error('PREVIEW_STALE');
 if(canonicalHash(current.understandingRef)!==canonicalHash(verified.filmSpec.understandingRef))throw Error('PREVIEW_OPERATION_CHANGED');
 if(bundle.expiresAt<=new Date().toISOString())throw Error('PREVIEW_STALE');
 const stored=await createOrRead(projects.store,key(projectId,bundle.previewId),bundle);
 if(canonicalHash(stored)!==canonicalHash(bundle))throw Error('PREVIEW_ID_CONFLICT');
 const publicationKey=`projects/${projectId}/previews/${bundle.previewId}/publication`;
 const publication={operationId,expectedConsentEpoch,bundleSha256:canonicalHash(bundle)};
 const isPublished=(control:ProjectControl)=>control.phase==='preview_ready'&&control.currentPreviewId===bundle.previewId&&control.previewState==='ready'&&!control.activeProduction;
 // A lost acknowledgement after control CAS must resume the same publication only.
 if(current.deletedAt||Date.parse(current.expiresAt)<=Date.now()||current.inputPending||current.briefVersion!==bundle.briefVersion||current.consentEpoch!==expectedConsentEpoch||(!isPublished(current)&&(current.phase!=='preparing_preview'||current.activeProduction!==operationId)))throw Error('PREVIEW_STALE');
 const saved=isPublished(current)?(await projects.store.readFresh(publicationKey)).value:await createOrRead(projects.store,publicationKey,publication);
 if(canonicalHash(saved)!==canonicalHash(publication))throw Error('PREVIEW_STALE');
 await assertPreviewOperation(projects,current,operationId,bundle.revisionId,bundle.previewId,expectedConsentEpoch);
 return updateJson(projects.store,`projects/${projectId}/control`,(control:ProjectControl)=>{
  if(canonicalHash(control.understandingRef)!==canonicalHash(current.understandingRef))throw Error('PREVIEW_STALE');
  if(isPublished(control)&&!control.deletedAt&&Date.parse(control.expiresAt)>Date.now()&&control.consentEpoch===expectedConsentEpoch&&control.briefVersion===bundle.briefVersion&&!control.inputPending)return control;
  if(control.deletedAt||Date.parse(control.expiresAt)<=Date.now()||control.phase!=='preparing_preview'||control.activeProduction!==operationId||control.consentEpoch!==expectedConsentEpoch||control.briefVersion!==bundle.briefVersion||control.inputPending)throw Error('PREVIEW_STALE');
  return{...control,controlVersion:control.controlVersion+1,phase:'preview_ready' as const,previewState:'ready' as const,currentPreviewId:bundle.previewId,activeProduction:null};
 });
}
