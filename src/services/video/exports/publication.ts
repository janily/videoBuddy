import {z} from 'zod';
import {ObjectRefSchema} from '@/contracts/video/domain';
import type {ProjectStore} from '@/services/video/storage/project-store';
import {readResultManifest} from '@/services/video/results/publish';
import {readPreviewBundle} from '@/services/video/preview/commit';
import {validateDelivery} from '@/services/video/quality/delivery';
import {canonicalHash} from '@/services/video/domain/hash';
import {actualArtifactSha256} from './verified-file';
import {inspectArtifact} from './access';
export const ExportPublicationSchema=z.strictObject({schemaVersion:z.literal(1),projectId:z.uuid(),resultId:z.uuid(),sourceArtifactId:z.uuid(),revisionId:z.uuid(),bundleHash:z.string().regex(/^[a-f0-9]{64}$/),resultHash:z.string().regex(/^[a-f0-9]{64}$/),format:z.literal('source_zip'),artifactId:z.uuid(),operationId:z.uuid(),objectRef:ObjectRefSchema});
export type ExportPublication=z.infer<typeof ExportPublicationSchema>;
export function exportKey(projectId:string,resultId:string){return `projects/${projectId}/results/${resultId}/exports/source_zip`}
export async function exportBaseline(projects:ProjectStore,owner:string,projectId:string,sourceArtifactId:string,root:string){
 const control=await projects.access(owner,projectId);
 const results=await Promise.all([control.currentResultId,control.previousResultId].filter((id):id is string=>Boolean(id)).map(id=>readResultManifest(projects,projectId,id)));
 const result=results.find(result=>result.artifactId===sourceArtifactId);if(!result)throw Error('RESULT_STALE');
 const bundle=await readPreviewBundle(projects,projectId,result.previewId,root),artifact=await inspectArtifact(projects,owner,projectId,sourceArtifactId);
 if(result.bundleHash!==bundle.bundleHash||result.revisionId!==bundle.revisionId||artifact.revisionId!==result.revisionId||artifact.objectRef.sha256!==result.mp4Sha256||artifact.objectRef.bytes!==result.mp4Bytes||artifact.objectRef.mime!=='video/mp4')throw Error('ARTIFACT_INVALID');
 const actualFileSha256=await actualArtifactSha256(root,artifact.objectRef.key,result.mp4Bytes);
 validateDelivery({policy:result.qualityPolicy,expectedPolicySha256:bundle.renderInputs.qualityPolicySha256,expectedFileSha256:result.mp4Sha256,actualFileSha256,checks:result.qualityChecks});
 return{result,resultHash:canonicalHash(result),bundle};
}
