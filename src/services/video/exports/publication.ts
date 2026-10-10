import {z} from 'zod';
import {ObjectRefSchema} from '@/contracts/video/domain';
import type {ProjectStore} from '@/services/video/storage/project-store';
import {readAnyResultManifest} from '@/services/video/results/publish-film';
import {canonicalHash} from '@/services/video/domain/hash';
import {actualArtifactSha256} from './verified-file';
import {inspectArtifact} from './access';
import {DurableExportFormatSchema,type DurableExportFormat} from './formats';
export const ExportPublicationSchema=z.strictObject({schemaVersion:z.literal(1),projectId:z.uuid(),resultId:z.uuid(),sourceArtifactId:z.uuid(),revisionId:z.uuid(),bundleHash:z.string().regex(/^[a-f0-9]{64}$/),resultHash:z.string().regex(/^[a-f0-9]{64}$/),format:DurableExportFormatSchema,artifactId:z.uuid(),operationId:z.uuid(),objectRef:ObjectRefSchema});
export type ExportPublication=z.infer<typeof ExportPublicationSchema>;
export function exportKey(projectId:string,resultId:string,format:DurableExportFormat='poster'){return `projects/${projectId}/results/${resultId}/exports/${format}`}
/** Only an owned current/previous completed film can authorize an export. */
export async function exportBaseline(projects:ProjectStore,owner:string,projectId:string,sourceArtifactId:string,root:string){
 const control=await projects.access(owner,projectId);
 const results=await Promise.all([control.currentResultId,control.previousResultId].filter((id):id is string=>Boolean(id)).map(id=>readAnyResultManifest(projects,projectId,id)));
 const result=results.find(result=>result.artifactId===sourceArtifactId);if(!result||result.kind!=='quick')throw Error('RESULT_STALE');
 const artifact=await inspectArtifact(projects,owner,projectId,sourceArtifactId);
 if(artifact.revisionId!==result.revisionId||artifact.objectRef.sha256!==result.mp4Sha256||artifact.objectRef.bytes!==result.mp4Bytes||artifact.objectRef.mime!=='video/mp4'||await actualArtifactSha256(root,artifact.objectRef.key,result.mp4Bytes)!==result.mp4Sha256)throw Error('ARTIFACT_INVALID');
 return{result,resultHash:canonicalHash(result),artifact};
}
