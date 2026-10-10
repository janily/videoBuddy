import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {persistArchiveObject} from '@/services/video/exports/archive-object';
import type {ArtifactRecord} from '@/services/video/exports/access';
import {canonicalHash} from '@/services/video/domain/hash';
import {createOrRead,updateJson} from '@/services/video/storage/atomic-store';
import type {ProjectControl} from '@/contracts/video/project';
import type {PreviewOperation} from '@/services/video/quick/prepare';
import type {QuickFilmOutput} from '@/services/video/quick/film';
import {z} from 'zod';
import type {ProjectStore} from '@/services/video/storage/project-store';
const Id=z.string().uuid(),Digest=z.string().regex(/^[a-f0-9]{64}$/);
const QuickManifest=z.strictObject({kind:z.literal('quick'),resultId:Id,artifactId:Id,revisionId:Id,operationId:Id,bundleHash:Digest,mp4Sha256:Digest,mp4Bytes:z.number().int().positive(),briefVersion:z.number().int().nonnegative(),styleSlug:z.string().min(1),aspect:z.enum(['16:9','9:16']),durationSec:z.number().int().positive(),
 shots:z.array(z.strictObject({id:z.string().min(1),scriptLine:z.string(),startFrame:z.number().int().nonnegative(),endFrame:z.number().int().positive(),take:z.number().int().nonnegative()})).min(1).max(80),
 music:z.strictObject({trackId:z.string(),title:z.string(),license:z.string()}).nullable(),aiLabel:z.literal(true),createdAt:z.string().datetime({offset:true})});
export type QuickResultManifest=z.infer<typeof QuickManifest>;
export type AnyResultManifest=QuickResultManifest;
export function quickResultKey(projectId:string,resultId:string){return `projects/${projectId}/results/${resultId}/manifest`}
export function parseQuickManifest(raw:unknown){return QuickManifest.parse(raw)}
export async function readAnyResultManifest(projects:ProjectStore,projectId:string,resultId:string):Promise<QuickResultManifest>{const result=parseQuickManifest((await projects.store.readFresh(quickResultKey(projectId,resultId))).value);if(result.resultId!==resultId)throw Error('RESULT_INVALID');return result}
export const readResultManifest=readAnyResultManifest;
export async function publishQuickFilm(projects:ProjectStore,projectId:string,operationId:string,op:PreviewOperation,film:QuickFilmOutput,root:string):Promise<QuickResultManifest>{
 if(op.id!==operationId||op.projectId!==projectId||op.kind!=='preview'||film.briefVersion!==op.briefVersion)throw Error('PREVIEW_STALE');
 const prefix=`projects/${projectId}`,intent=await createOrRead(projects.store,`${prefix}/operations/${operationId}/quick-publication`,{resultId:randomUUID(),artifactId:randomUUID(),createdAt:new Date().toISOString()});
 const bytes=await readFile(film.outputPath);
 if(bytes.length!==film.bytes)throw Error('QA_FAILED');
 const objectKey=`${prefix}/artifacts/${intent.artifactId}/files/final.mp4`;
 await persistArchiveObject(root,objectKey,film.sha256,bytes);
 const artifact:ArtifactRecord={id:intent.artifactId,revisionId:op.revisionId,objectRef:{key:objectKey,sha256:film.sha256,bytes:film.bytes,mime:'video/mp4'},qaPassed:true,uploaded:true,filename:'VideoBuddy.mp4'};
 if(canonicalHash(await createOrRead(projects.store,`${prefix}/artifacts/${intent.artifactId}/manifest`,artifact))!==canonicalHash(artifact))throw Error('ARTIFACT_INVALID');
 const result=parseQuickManifest({kind:'quick',resultId:intent.resultId,artifactId:intent.artifactId,revisionId:op.revisionId,operationId,bundleHash:canonicalHash({kind:'quick-film-v1',sha256:film.sha256}),mp4Sha256:film.sha256,mp4Bytes:film.bytes,briefVersion:film.briefVersion,styleSlug:film.styleSlug,aspect:film.aspect,durationSec:film.durationSec,shots:film.shots,music:film.music,aiLabel:true,createdAt:intent.createdAt});
 if(canonicalHash(await createOrRead(projects.store,quickResultKey(projectId,result.resultId),result))!==canonicalHash(result))throw Error('RESULT_ID_CONFLICT');
 await updateJson(projects.store,`${prefix}/control`,async(c:ProjectControl)=>{
  const current=(await projects.store.readFresh<PreviewOperation>(`${prefix}/operations/${operationId}`)).value;
  if(current.status!=='running'||current.fence!==op.fence)throw Error('PREVIEW_STALE');
  if(c.currentResultId===result.resultId)return c;
  if(c.deletedAt||Date.parse(c.expiresAt)<=Date.now()||c.inputPending||c.phase!=='generating'||canonicalHash(c.understandingRef)!==canonicalHash(op.understandingRef)||c.activeProduction!==operationId||c.consentEpoch!==op.consentEpoch||c.briefVersion!==op.briefVersion)throw Error('PREVIEW_STALE');
  return{...c,controlVersion:c.controlVersion+1,phase:'ready' as const,previousResultId:c.currentResultId,currentResultId:result.resultId,activeProduction:null,previewOutcomes:{...c.previewOutcomes,[operationId]:{status:'succeeded' as const}},latestPreviewOutcome:{operationId,briefVersion:op.briefVersion,consentEpoch:op.consentEpoch,controlVersion:c.controlVersion+1}};
 });
 return result;
}
