import {createHash} from 'node:crypto';
import {join,isAbsolute} from 'node:path';
import {lstat,mkdtemp,readFile,realpath,rm} from 'node:fs/promises';
import sharp from 'sharp';
import {z} from 'zod';
import type {ProjectStore} from '@/services/video/storage/project-store';
import {mediaBinaries,runProcess} from '@/services/video/media/local/ffmpeg';
import {exportBaseline} from './publication';
const TimelineSchema=z.object({fps:z.union([z.literal(24),z.literal(30),z.literal(60)]),totalFrames:z.number().int().min(1).max(7200),shots:z.array(z.object({startFrame:z.number().int().nonnegative(),endFrame:z.number().int().positive()})).min(1)});
/** Select a real opening-shot midpoint, preserving final film frame identity. */
export function posterFrame(raw:unknown){
 const parsed=TimelineSchema.safeParse(raw);if(!parsed.success)throw Error('EXPORT_POSTER_INVALID');
 const timeline=parsed.data;let end=0;
 for(const shot of timeline.shots){if(shot.startFrame!==end||shot.endFrame<=shot.startFrame||shot.endFrame>timeline.totalFrames)throw Error('EXPORT_POSTER_INVALID');end=shot.endFrame}
 if(end!==timeline.totalFrames)throw Error('EXPORT_POSTER_INVALID');
 return Math.floor((timeline.shots[0].endFrame-1)/2);
}
export interface PosterInput{sourcePath:string;frame:number}
export function posterArguments(input:PosterInput,outputDir:string){
 const safe=(path:string)=>isAbsolute(path)&&!/[\0\r\n]/.test(path);
 if(!safe(input.sourcePath)||!safe(outputDir)||!Number.isSafeInteger(input.frame)||input.frame<0||input.frame>=7200)throw Error('EXPORT_POSTER_INVALID');
 return['-hide_banner','-loglevel','error','-nostdin','-y','-protocol_whitelist','file,pipe','-i',input.sourcePath,'-vf',`select=eq(n\\,${input.frame})`,'-frames:v','1','-an',join(outputDir,'poster.png')];
}
async function extractPoster(root:string,input:PosterInput,assertActive:()=>Promise<void>){
 const base=await realpath(root),directory=await mkdtemp(join(base,'export-poster-')),abort=new AbortController();let pending=false,fenceError:unknown;
 const monitor=setInterval(()=>{if(pending)return;pending=true;void assertActive().catch(error=>{fenceError=error;abort.abort()}).finally(()=>{pending=false})},250);
 try{
  await assertActive();await runProcess(mediaBinaries().ffmpeg,posterArguments(input,directory),{signal:abort.signal,timeoutMs:120000});await assertActive();
  const path=join(directory,'poster.png'),info=await lstat(path);if(!info.isFile()||info.isSymbolicLink()||info.nlink!==1||info.size>8*1024*1024)throw Error('EXPORT_POSTER_INVALID');
  return await readFile(path);
 }catch(error){throw fenceError||error}
 finally{clearInterval(monitor);abort.abort();await rm(directory,{recursive:true,force:true})}
}
export async function prepareExportPoster(projects:ProjectStore,owner:string,projectId:string,sourceArtifactId:string,root:string,options:{assertActive?:()=>Promise<void>;extract?:(root:string,input:PosterInput,assertActive:()=>Promise<void>)=>Promise<Buffer>}={}){
 const baseline=await exportBaseline(projects,owner,projectId,sourceArtifactId,root),{result,artifact}=baseline;
 const totalFrames=result.shots.at(-1)!.endFrame,frame=posterFrame({fps:totalFrames/result.durationSec,totalFrames,shots:result.shots});
 const assertActive=async()=>{await options.assertActive?.();if((await exportBaseline(projects,owner,projectId,sourceArtifactId,root)).resultHash!==baseline.resultHash)throw Error('RESULT_STALE')};
 await assertActive();
 const bytes=await(options.extract||extractPoster)(root,{sourcePath:join(await realpath(root),'objects',artifact.objectRef.key),frame},assertActive);
 if(bytes.length<33||bytes.length>8*1024*1024||bytes.subarray(0,8).toString('hex')!=='89504e470d0a1a0a')throw Error('EXPORT_POSTER_INVALID');
 const image=sharp(bytes,{limitInputPixels:3840*3840}),metadata=await image.metadata().catch(()=>null);
 if(!metadata||metadata.format!=='png'||!metadata.width||!metadata.height||metadata.width<64||metadata.height<64||metadata.width>3840||metadata.height>3840||metadata.width/metadata.height!==(result.aspect==='16:9'?16/9:9/16))throw Error('EXPORT_POSTER_INVALID');
 await image.raw().toBuffer().catch(()=>{throw Error('EXPORT_POSTER_INVALID')});
 const sha256=createHash('sha256').update(bytes).digest('hex');await assertActive();
 await projects.index.immutable(`projects/${projectId}/results/${result.resultId}/poster-provenance`,{schemaVersion:1,resultHash:baseline.resultHash,sourceArtifactId,filmSha256:result.mp4Sha256,frame,width:metadata.width,height:metadata.height,posterSha256:sha256});
 return{bytes,sha256,manifest:{bundleHash:result.bundleHash,revisionId:result.revisionId}};
}
