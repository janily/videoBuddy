import type{ProjectStore}from'@/services/video/storage/project-store';
import{ObjectRef}from'@/contracts/video/domain';
import{assertArtifactAccess}from'./export';
import{issueArtifactToken}from'./local-token';
import{canonicalHash}from'@/services/video/domain/hash';
import{StoreMissing}from'@/services/video/storage/atomic-store';
import {ExportPublicationSchema} from './publication';
import {exportFiles} from './formats';
export interface ArtifactRecord{id:string;revisionId:string;objectRef:ObjectRef;qaPassed:boolean;uploaded:boolean;filename:string}
export async function inspectArtifact(projects:ProjectStore,owner:string,projectId:string,artifactId:string){
 const control=await projects.access(owner,projectId);
 const artifact=(await projects.store.readFresh<ArtifactRecord>(`projects/${projectId}/artifacts/${artifactId}/manifest`)).value;
 assertArtifactAccess(control,{qaPassed:artifact.qaPassed,uploaded:artifact.uploaded,mime:artifact.objectRef.mime});
 if(artifact.id!==artifactId||!artifact.objectRef.key.startsWith(`projects/${projectId}/artifacts/${artifactId}/files/`)||!/^[a-zA-Z0-9/_-]+\.[a-zA-Z0-9]+$/.test(artifact.objectRef.key))throw Error('ACCESS_NOT_FOUND');
 return artifact;
}
export async function resolveArtifact(projects:ProjectStore,owner:string,projectId:string,artifactId:string){
 const artifact=await inspectArtifact(projects,owner,projectId,artifactId),control=await projects.access(owner,projectId);
 let published=false;
 if(control.currentPreviewId){
  const preview=await projects.store.readFresh<{previewArtifactId:string;revisionId:string}>(`projects/${projectId}/previews/${control.currentPreviewId}/manifest`);
  published=preview.value.previewArtifactId===artifactId&&preview.value.revisionId===artifact.revisionId;
 }
 for(const resultId of[control.currentResultId,control.previousResultId])if(resultId&&!published){
  const result=await projects.store.readFresh<{artifactId:string;revisionId:string}>(`projects/${projectId}/results/${resultId}/manifest`);
  published=result.value.artifactId===artifactId&&result.value.revisionId===artifact.revisionId;
  if(!published&&control.publishedExports?.[artifactId]){
   try{
    const record=ExportPublicationSchema.parse((await projects.store.readFresh(`projects/${projectId}/artifacts/${artifactId}/export-publication`)).value),file=exportFiles[record.format];
    published=record.projectId===projectId&&record.resultId===resultId&&record.sourceArtifactId===result.value.artifactId&&record.artifactId===artifactId&&record.revisionId===artifact.revisionId&&record.revisionId===result.value.revisionId&&record.resultHash===canonicalHash(result.value)&&record.objectRef.key===`projects/${projectId}/artifacts/${artifactId}/files/${file.file}`&&record.objectRef.mime===file.mime&&canonicalHash(record.objectRef)===canonicalHash(artifact.objectRef)&&canonicalHash(record)===control.publishedExports[artifactId];
   }catch(error){if(!(error instanceof StoreMissing))throw error}
  }
 }
 if(!published)throw Error('ACCESS_NOT_FOUND');
 return artifact;
}
export async function getArtifactAccess(projects:ProjectStore,owner:string,projectId:string,artifactId:string,purpose:'play'|'download'){
 const artifact=await resolveArtifact(projects,owner,projectId,artifactId),key=process.env.VIDEO_SESSION_SIGNING_KEY;
 if(purpose==='play'&&artifact.objectRef.mime!=='video/mp4')throw Error('ACCESS_NOT_FOUND');
 if(!key)throw Error('CONFIGURATION_REQUIRED');
 const token=issueArtifactToken({projectId,artifactId,owner,purpose},key),expiresAt=new Date(Date.now()+180000).toISOString();
 return{url:`/api/video/projects/${projectId}/artifacts/${artifactId}/file?purpose=${purpose}&token=${encodeURIComponent(token)}`,expiresAt,mime:artifact.objectRef.mime,filename:artifact.filename,purpose};
}
