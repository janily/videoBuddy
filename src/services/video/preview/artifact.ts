import{randomUUID}from'node:crypto';
import{constants}from'node:fs';
import{copyFile,link,mkdir,open,rm}from'node:fs/promises';
import{isAbsolute,join}from'node:path';
import{z}from'zod';
import type{Environment}from'@/services/video/config/environment';
import type{ProjectControl}from'@/contracts/video/project';
import type{ArtifactRecord}from'@/services/video/exports/access';
import{actualArtifactSha256}from'@/services/video/exports/verified-file';
import{canonicalHash}from'@/services/video/domain/hash';
import{dockerConfiguration}from'@/services/video/media/docker-executor';
import{technicalVideoQa}from'@/services/video/media/technical-qa';
import{createOrRead}from'@/services/video/storage/atomic-store';
import type{ProjectStore}from'@/services/video/storage/project-store';
import{previewExcerptStageKey,type renderPreviewExcerpt}from'./render-excerpt';

type RenderedPreview=Awaited<ReturnType<typeof renderPreviewExcerpt>>;
export async function stagePreviewArtifact(projects:ProjectStore,root:string,projectId:string,revisionId:string,artifactId:string,preview:RenderedPreview,env:Environment=process.env){
 const uuid=z.string().uuid(),digest=/^[a-f0-9]{64}$/;
 if(!isAbsolute(root)||!/^\/[A-Za-z0-9_./-]+$/.test(root)||![projectId,revisionId,artifactId].every(value=>uuid.safeParse(value).success)||!digest.test(preview.stageKey)||!digest.test(preview.sha256)||!digest.test(preview.sourceFilmSha256)||preview.outputPath!==join(root,'preview',preview.stageKey,'output','preview.mp4')||!Number.isSafeInteger(preview.bytes)||preview.bytes<1024||!Number.isSafeInteger(preview.durationMs)||preview.durationMs<6000||preview.durationMs>12000)throw Error('PREVIEW_ARTIFACT_INVALID');
 const control=(await projects.store.readFresh<ProjectControl>(`projects/${projectId}/control`)).value;
 if(control.projectId!==projectId||control.deletedAt||Date.parse(control.expiresAt)<=Date.now())throw Error('PREVIEW_ARTIFACT_INVALID');
 const config=dockerConfiguration(env,'preview-artifact');
 if(previewExcerptStageKey({fullFilmSha256:preview.sourceFilmSha256,segments:preview.excerptMap,width:preview.technicalQa.width,height:preview.technicalQa.height,fps:preview.technicalQa.fps as 24|30|60,runtimeDigest:config.runtimeDigest})!==preview.stageKey)throw Error('PREVIEW_ARTIFACT_INVALID');
 const qa=await technicalVideoQa(join(root,'preview',preview.stageKey),config.image,'output/preview.mp4',{width:preview.technicalQa.width,height:preview.technicalQa.height,durationSec:preview.durationMs/1000,fps:preview.technicalQa.fps,audio:true});
 if(qa.sha256!==preview.sha256||qa.bytes!==preview.bytes||qa.result!=='pass'||preview.technicalQa.result!=='pass'||qa.width!==preview.technicalQa.width||qa.height!==preview.technicalQa.height||qa.fps!==preview.technicalQa.fps||qa.audio!==preview.technicalQa.audio)throw Error('PREVIEW_ARTIFACT_INVALID');
 const key=`projects/${projectId}/artifacts/${artifactId}/files/preview.mp4`,directory=join(root,'objects',`projects/${projectId}/artifacts/${artifactId}/files`),destination=join(root,'objects',key),temp=join(directory,`preview-${randomUUID()}.tmp`);
 await mkdir(directory,{recursive:true,mode:0o700});
 try{
  await copyFile(preview.outputPath,temp,constants.COPYFILE_EXCL);
  const file=await open(temp,'r');try{await file.sync()}finally{await file.close()}
  try{await link(temp,destination)}catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error}
  const dir=await open(directory,constants.O_RDONLY);try{await dir.sync()}finally{await dir.close()}
 }finally{await rm(temp,{force:true})}
 if(await actualArtifactSha256(root,key,qa.bytes)!==qa.sha256)throw Error('PREVIEW_ARTIFACT_MISMATCH');
 const record:ArtifactRecord&{sourceFilmSha256:string;excerptStageKey:string}={id:artifactId,revisionId,objectRef:{key,sha256:qa.sha256,bytes:qa.bytes,mime:'video/mp4'},qaPassed:true,uploaded:true,filename:'preview.mp4',sourceFilmSha256:preview.sourceFilmSha256,excerptStageKey:preview.stageKey};
 const stored=await createOrRead(projects.store,`projects/${projectId}/artifacts/${artifactId}/manifest`,record);
 if(canonicalHash(stored)!==canonicalHash(record))throw Error('PREVIEW_ARTIFACT_MISMATCH');
 return record;
}
