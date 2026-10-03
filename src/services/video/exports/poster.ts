import {createHash} from 'node:crypto';
import {join} from 'node:path';
import {realpath} from 'node:fs/promises';
import {z} from 'zod';
import type {ProjectStore} from '@/services/video/storage/project-store';
import {canonicalHash} from '@/services/video/domain/hash';
import {verifyPreviewPackage} from '@/services/video/preview/package';
import {extractVisualFrames,readVisualEvidence} from '@/services/video/quality/visual-evidence';
import {exportBaseline} from './publication';
import {inspectArtifact} from './access';
const TimelineSchema=z.object({fps:z.union([z.literal(24),z.literal(30),z.literal(60)]),totalFrames:z.number().int().min(1).max(7200),shots:z.array(z.object({startFrame:z.number().int().nonnegative(),endFrame:z.number().int().positive()})).min(1)});
/** A deterministic real frame from the midpoint of the opening shot. */
export function posterFrame(raw:unknown){
 const parsed=TimelineSchema.safeParse(raw);if(!parsed.success)throw Error('EXPORT_POSTER_INVALID');
 const timeline=parsed.data;let end=0;
 for(const shot of timeline.shots){if(shot.startFrame!==end||shot.endFrame<=shot.startFrame||shot.endFrame>timeline.totalFrames)throw Error('EXPORT_POSTER_INVALID');end=shot.endFrame}
 if(end!==timeline.totalFrames)throw Error('EXPORT_POSTER_INVALID');
 return Math.floor((timeline.shots[0].endFrame-1)/2);
}
export async function prepareExportPoster(projects:ProjectStore,owner:string,projectId:string,sourceArtifactId:string,root:string,options:{assertActive?:()=>Promise<void>;extract?:typeof extractVisualFrames;readImages?:typeof readVisualEvidence}={}){
 const baseline=await exportBaseline(projects,owner,projectId,sourceArtifactId,root),frozen=await verifyPreviewPackage(projects,projectId,baseline.bundle,root);
 const artifact=await inspectArtifact(projects,owner,projectId,sourceArtifactId),frame=posterFrame(frozen.timeline),{width,height,totalFrames}=frozen.filmSpec.output;
 const assertActive=async()=>{
  await options.assertActive?.();const current=await exportBaseline(projects,owner,projectId,sourceArtifactId,root);
  if(current.resultHash!==baseline.resultHash||current.bundle.bundleHash!==baseline.bundle.bundleHash)throw Error('RESULT_STALE');
 };
 await assertActive();
 const storageRoot=await realpath(root);
 const evidence=await (options.extract||extractVisualFrames)(storageRoot,{outputPath:join(storageRoot,'objects',artifact.objectRef.key),sha256:baseline.result.mp4Sha256,width,height,totalFrames},[frame],'sha256:'+frozen.filmSpec.runtimeDigest,{assertActive,publishedArtifact:{projectId,artifactId:sourceArtifactId}});
 if(evidence.filmSha256!==baseline.result.mp4Sha256||evidence.runtimeDigest!==frozen.filmSpec.runtimeDigest||evidence.width!==width||evidence.height!==height||evidence.frames.length!==1||evidence.frames[0].frame!==frame||evidence.frames[0].id!=='frame-'+frame)throw Error('EXPORT_POSTER_INVALID');
 const images=await (options.readImages||readVisualEvidence)(storageRoot,evidence),raw=images.get('frame-'+frame);
 if(!raw||images.size!==1)throw Error('EXPORT_POSTER_INVALID');
 const bytes=Buffer.from(raw),sha256=createHash('sha256').update(bytes).digest('hex');
 if(bytes.length<33||bytes.length>8*1024*1024||bytes.subarray(0,8).toString('hex')!=='89504e470d0a1a0a'||bytes.toString('ascii',12,16)!=='IHDR'||bytes.readUInt32BE(16)!==width||bytes.readUInt32BE(20)!==height||bytes.length!==evidence.frames[0].bytes||sha256!==evidence.frames[0].sha256)throw Error('EXPORT_POSTER_INVALID');
 await assertActive();
 await projects.index.immutable(`projects/${projectId}/results/${baseline.result.resultId}/poster-provenance`,{schemaVersion:1,resultHash:baseline.resultHash,sourceArtifactId,filmSha256:baseline.result.mp4Sha256,frame,width,height,posterSha256:sha256,evidenceHash:canonicalHash(evidence),evidence});
 return{bytes,sha256,manifest:{bundleHash:baseline.bundle.bundleHash,revisionId:baseline.bundle.revisionId}};
}
