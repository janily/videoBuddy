import {randomUUID} from 'node:crypto';
import {lstat,readFile} from 'node:fs/promises';
import {canonicalHash} from '@/services/video/domain/hash';
import {createOrRead,updateJson} from '@/services/video/storage/atomic-store';
import type {ProjectStore} from '@/services/video/storage/project-store';
import {persistArchiveObject} from '@/services/video/exports/archive-object';
import type {ArtifactRecord} from '@/services/video/exports/access';
import type {CanvasProgress,ShotProgress} from './script';

export async function saveShotProgress(projects:ProjectStore,base:string,shotId:string,progress:ShotProgress){
 await createOrRead<CanvasProgress>(projects.store,`${base}/canvas`,{shots:{}});
 return updateJson(projects.store,`${base}/canvas`,(value:CanvasProgress)=>({shots:{...value.shots,[shotId]:{...(value.shots[shotId]?.take===progress.take?value.shots[shotId]:{}),...progress}}}));
}
/** The artifact record and canvas reference jointly authorize owner-only access. */
export async function publishShotArtifact(projects:ProjectStore,root:string,input:{projectId:string;operationId:string;revisionId:string;base:string;shotId:string;take:number;path:string;mime:'image/png'|'video/mp4';expectedSha256?:string},assertActive:()=>Promise<void>){
 const stat=await lstat(input.path);if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||!stat.size)throw Error('OUTPUT_INVALID');
 const bytes=await readFile(input.path),sha256=canonicalHashBytes(bytes);
 if(input.expectedSha256&&input.expectedSha256!==sha256)throw Error('QA_FAILED');
 if(input.mime==='image/png'&&(bytes.length<24||bytes.subarray(0,8).toString('hex')!=='89504e470d0a1a0a'||bytes.readUInt32BE(16)<64||bytes.readUInt32BE(20)<64||bytes.readUInt32BE(16)>3840||bytes.readUInt32BE(20)>3840))throw Error('OUTPUT_INVALID');
 const intent=await createOrRead(projects.store,`${input.base}/artifacts/${canonicalHash({shotId:input.shotId,take:input.take,mime:input.mime,sha256})}`,{artifactId:randomUUID()});
 const filename=input.mime==='image/png'?'poster.png':'final.mp4',objectKey=`projects/${input.projectId}/artifacts/${intent.artifactId}/files/${filename}`;
 await assertActive();await persistArchiveObject(root,objectKey,sha256,bytes);
 const artifact:ArtifactRecord={id:intent.artifactId,revisionId:input.revisionId,objectRef:{key:objectKey,sha256,bytes:bytes.length,mime:input.mime},qaPassed:true,uploaded:true,filename,quickShot:{base:input.base,shotId:input.shotId}};
 const saved=await createOrRead(projects.store,`projects/${input.projectId}/artifacts/${intent.artifactId}/manifest`,artifact);
 // A cache hit from another film operation retains its original revision binding.
 if(canonicalHash(saved.objectRef)!==canonicalHash(artifact.objectRef)||canonicalHash(saved.quickShot)!==canonicalHash(artifact.quickShot))throw Error('ARTIFACT_INVALID');
 await assertActive();
 await saveShotProgress(projects,input.base,input.shotId,{state:input.mime==='image/png'?'drawn':'rendered',take:input.take,...(input.mime==='image/png'?{posterArtifactId:intent.artifactId}:{clipArtifactId:intent.artifactId})});
 return intent.artifactId;
}
import {createHash} from 'node:crypto';
function canonicalHashBytes(bytes:Buffer){return createHash('sha256').update(bytes).digest('hex')}
