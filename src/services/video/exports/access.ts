import {issueSignedToken,presignUrl}from '@vercel/blob';
import {ProjectStore}from '@/services/video/storage/project-store';
import {ObjectRef}from '@/contracts/video/domain';
import {assertArtifactAccess}from './export';
export interface ArtifactRecord{id:string;revisionId:string;objectRef:ObjectRef;qaPassed:boolean;uploaded:boolean;filename:string}
export async function getArtifactAccess(projects:ProjectStore,owner:string,projectId:string,artifactId:string,purpose:'play'|'download'){
 const control=await projects.access(owner,projectId);const artifact=(await projects.store.readFresh<ArtifactRecord>(`projects/${projectId}/artifacts/${artifactId}/manifest`)).value;
 assertArtifactAccess(control,{qaPassed:artifact.qaPassed,uploaded:artifact.uploaded,mime:artifact.objectRef.mime});if(artifact.id!==artifactId||!artifact.objectRef.key.startsWith(`video-v5/${process.env.VIDEO_ENVIRONMENT}/projects/${projectId}/artifacts/${artifactId}/`))throw Error('ACCESS_NOT_FOUND');
 const validUntil=Date.now()+180000;const token=await issueSignedToken({token:process.env.BLOB_READ_WRITE_TOKEN,pathname:artifact.objectRef.key,operations:['get'],validUntil});const signed=await presignUrl(token,{operation:'get',pathname:artifact.objectRef.key,access:'private',validUntil});return{url:signed.presignedUrl,expiresAt:new Date(validUntil).toISOString(),mime:artifact.objectRef.mime,filename:artifact.filename,purpose};
}
