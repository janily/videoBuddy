import{RestoreResultRequestSchema,type RestoreResultRequest}from '@/contracts/video/commands';
import type{ProjectControl}from '@/contracts/video/project';
import{canonicalHash}from '@/services/video/domain/hash';
import{inspectArtifact}from '@/services/video/exports/access';
import{actualArtifactSha256}from '@/services/video/exports/verified-file';
import{StoreMissing,createOrRead,updateJson}from '@/services/video/storage/atomic-store';
import type{ProjectStore}from '@/services/video/storage/project-store';
import{readResultManifest}from './publish';

interface RestoreIntent{hash:string;fromResultId:string;toResultId:string;artifactId:string;completed:boolean}
export async function restoreResult(projects:ProjectStore,owner:string,projectId:string,artifactId:string,untrusted:RestoreResultRequest,storageRoot:string){
 const request=RestoreResultRequestSchema.parse(untrusted),control=await projects.access(owner,projectId),p=`projects/${projectId}`;
 const key=`${p}/commands/${request.clientCommandId}`,hash=canonicalHash({kind:'restore_result',body:request,artifactId});
 let intent:RestoreIntent|undefined;
 try{intent=(await projects.store.readFresh<RestoreIntent>(key)).value}catch(error){if(!(error instanceof StoreMissing))throw error}
 if(intent&&intent.hash!==hash)throw Error('IDEMPOTENCY_CONFLICT');
 if(intent?.completed)return projects.view(owner,projectId);
 if(!intent){
  if(!control.previousResultId||!control.currentResultId||control.activeProduction||control.phase!=='ready')throw Error('RESULT_STALE');
  const previous=await readResultManifest(projects,projectId,control.previousResultId);
  if(previous.artifactId!==artifactId)throw Error('RESULT_STALE');
  intent=await createOrRead(projects.store,key,{hash,fromResultId:control.currentResultId,toResultId:control.previousResultId,artifactId,completed:false});
  if(intent.hash!==hash)throw Error('IDEMPOTENCY_CONFLICT');
 }
 const target=await readResultManifest(projects,projectId,intent.toResultId);
 if(target.artifactId!==intent.artifactId)throw Error('RESULT_STALE');
 const artifact=await inspectArtifact(projects,owner,projectId,target.artifactId);
 if(artifact.revisionId!==target.revisionId||artifact.objectRef.sha256!==target.mp4Sha256||artifact.objectRef.bytes!==target.mp4Bytes||artifact.objectRef.mime!=='video/mp4'||await actualArtifactSha256(storageRoot,artifact.objectRef.key,target.mp4Bytes)!==target.mp4Sha256)throw Error('ARTIFACT_INVALID');
 await updateJson(projects.store,`${p}/control`,(current:ProjectControl)=>{
  if(current.lastRestoreCommandId===request.clientCommandId)return current;
  if(current.deletedAt||current.ownerKeyHash!==owner||current.activeProduction||current.phase!=='ready'||current.currentResultId!==intent!.fromResultId||current.previousResultId!==intent!.toResultId)throw Error('RESULT_STALE');
  return{...current,controlVersion:current.controlVersion+1,consentEpoch:current.consentEpoch+1,currentResultId:intent!.toResultId,previousResultId:intent!.fromResultId,lastRestoreCommandId:request.clientCommandId,previewState:current.previewState==='ready'?'stale' as const:current.previewState};
 });
 await updateJson(projects.store,key,(value:RestoreIntent)=>({...value,completed:true}));
 return projects.view(owner,projectId);
}
