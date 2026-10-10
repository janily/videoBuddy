import {join} from 'node:path';
import {rename,rm} from 'node:fs/promises';
import {z} from 'zod';
import {canonicalHash} from '@/services/video/domain/hash';
import type {AssembleInput,MediaOptions,RenderedVideo} from '../runtime';
import type {LocalContext} from './renderer';
import {requireRuntimePath} from './renderer';
import {aiMetadata,assembleArguments} from './arguments';
import {assertNotAborted,runProcess} from './ffmpeg';
import {durableWrite,fileIdentity,publishDirectory,serialized,temporaryStage,verifiedBytes} from './files';
import {readVideoCache,videoManifest} from './cache';
import {probeVideo} from './probe';
export async function assemble(runtime:LocalContext,input:AssembleInput,options:MediaOptions={}):Promise<RenderedVideo>{
 assertNotAborted(options.signal);
 if(!z.uuid().safeParse(input.projectId).success||!Array.isArray(input.clips)||input.clips.length<1||input.clips.length>80||typeof input.title!=='string')throw Error('ASSEMBLY_INVALID');
 const first=input.clips[0],fps=first.fps,frameCount=input.clips.reduce((total,clip)=>total+clip.frameCount,0),durationSec=frameCount/fps;
 if(!Number.isSafeInteger(frameCount)||frameCount<1||durationSec>120||!Number.isFinite(durationSec))throw Error('ASSEMBLY_INVALID');
 for(const clip of input.clips){
  requireRuntimePath(join(runtime.root,'media'),clip.outputPath);
  if(clip.kind!=='clip'||clip.runtimeDigest!==runtime.runtimeDigest||clip.width!==first.width||clip.height!==first.height||clip.fps!==fps||clip.audio||!Number.isSafeInteger(clip.frameCount))throw Error('ASSEMBLY_CLIP_MISMATCH');
  const cached=await readVideoCache(join(runtime.root,'media',clip.key),clip.key,runtime.runtimeDigest,canonicalHash({key:clip.key,runtimeDigest:runtime.runtimeDigest}));
  if(!cached||canonicalHash(cached)!==canonicalHash(clip))throw Error('MEDIA_CACHE_INVALID');
 }
 const identity={version:'local-assemble-v1',projectId:input.projectId,runtimeDigest:runtime.runtimeDigest,clips:input.clips.map(clip=>({key:clip.key,sha256:clip.sha256,bytes:clip.bytes})),music:input.music?{trackId:input.music.trackId,sha256:input.music.sha256,bytes:input.music.bytes}:null,title:input.title};
 const key=canonicalHash(identity),parent=join(runtime.root,'media','assembly'),stage=join(parent,key),inputHash=key;
 return serialized(stage,async()=>{
  assertNotAborted(options.signal);const cached=await readVideoCache(stage,key,runtime.runtimeDigest,inputHash);if(cached)return cached;
  const temp=await temporaryStage(parent,key);
  try{
   let musicPath:string|null=null;
   if(input.music){requireRuntimePath(runtime.musicRoot,input.music.path);if(!/^[a-f0-9]{64}$/.test(input.music.sha256)||!Number.isSafeInteger(input.music.bytes)||input.music.bytes<1)throw Error('MUSIC_INPUT_INVALID');const bytes=await verifiedBytes(input.music.path,input.music,100*1024*1024);musicPath=join(temp,'music.input');await durableWrite(musicPath,bytes)}
   const listPath=join(temp,'clips.txt');await durableWrite(listPath,input.clips.map(clip=>`file '${clip.outputPath.replace(/'/g,"'\\''")}'`).join('\n')+'\n');
   const partial=join(temp,'final.mp4.partial');await runProcess(runtime.ffmpeg,assembleArguments(listPath,partial,{durationSec,title:input.title,musicPath}),{signal:options.signal,timeoutMs:runtime.timeoutMs});
   const metadata=await probeVideo(partial,runtime.ffprobe,{signal:options.signal,fullDecode:true,expected:{width:first.width,height:first.height,fps,durationSec,audio:true}});
   if(metadata.tags.aigc!==aiMetadata||metadata.tags.comment!==aiMetadata)throw Error('QA_FAILED: AI metadata');
   // Inputs are immutable by contract, but hash them after reading as well to
   // detect mutation during a long local ffmpeg read. No extra decoding occurs.
   for(const clip of input.clips)await fileIdentity(clip.outputPath,clip);
   assertNotAborted(options.signal);await rename(partial,join(temp,'final.mp4'));
   const result:RenderedVideo={...metadata,key,kind:'final',outputPath:join(stage,'final.mp4'),runtimeDigest:runtime.runtimeDigest,manifestPath:join(stage,'manifest.json')};
   await durableWrite(join(temp,'manifest.json'),JSON.stringify(videoManifest(key,runtime.version,result,inputHash)));assertNotAborted(options.signal);await publishDirectory(temp,stage);
   return(await readVideoCache(stage,key,runtime.runtimeDigest,inputHash))!;
  }finally{await rm(temp,{recursive:true,force:true})}
 });
}
