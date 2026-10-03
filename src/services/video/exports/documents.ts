import {createHash} from 'node:crypto';
import type {ProjectStore} from '@/services/video/storage/project-store';
import {canonicalHash,canonicalJson} from '@/services/video/domain/hash';
import {verifyPreviewPackage} from '@/services/video/preview/package';
import {exportBaseline} from './publication';
import {assertArchiveText} from './source-zip';
import type {DurableExportFormat} from './formats';

type Caption={text:string;startFrame:number;endFrame:number};
function timestamp(ms:number){
 const hours=Math.floor(ms/3600000),minutes=Math.floor(ms/60000)%60,seconds=Math.floor(ms/1000)%60;
 return [hours,minutes,seconds].map(x=>String(x).padStart(2,'0')).join(':')+','+String(ms%1000).padStart(3,'0');
}
/** Timing is from the full frozen film, never the excerpt or ASR guesses. */
export function encodeSubtitles(timeline:{fps:number;totalFrames:number;captions:Caption[]}){
 if(!timeline.captions.length)throw Error('EXPORT_NOT_APPLICABLE');
 if(![24,30,60].includes(timeline.fps)||!Number.isSafeInteger(timeline.totalFrames)||timeline.totalFrames<1)throw Error('EXPORT_DOCUMENT_INVALID');
 return [...timeline.captions].sort((a,b)=>a.startFrame-b.startFrame||a.endFrame-b.endFrame).map((caption,index)=>{
  const text=caption.text.replace(/\r\n?/g,'\n');
  if(!Number.isSafeInteger(caption.startFrame)||!Number.isSafeInteger(caption.endFrame)||caption.startFrame<0||caption.startFrame>=caption.endFrame||caption.endFrame>timeline.totalFrames||!text.trim()||/[\u0000-\u0008\u000b-\u001f\u007f]/.test(text)||/\n\s*\n|-->/.test(text))throw Error('EXPORT_DOCUMENT_INVALID');
  assertArchiveText(text);
  // Start rounds down and end rounds up to preserve the complete frame interval.
  return `${index+1}\r\n${timestamp(Math.floor(caption.startFrame*1000/timeline.fps))} --> ${timestamp(Math.ceil(caption.endFrame*1000/timeline.fps))}\r\n${text.split('\n').join('\r\n')}\r\n\r\n`;
 }).join('');
}
export async function prepareExportDocument(projects:ProjectStore,owner:string,projectId:string,sourceArtifactId:string,format:Exclude<DurableExportFormat,'source_zip'>,root:string){
 const baseline=await exportBaseline(projects,owner,projectId,sourceArtifactId,root),frozen=await verifyPreviewPackage(projects,projectId,baseline.bundle,root);
 let text:string;
 if(format==='srt')text=encodeSubtitles(frozen.timeline);
 else if(format==='treatment')text=frozen.treatment.summary+'\n\n'+frozen.treatment.script.join('\n\n')+'\n';
 else if(format==='quality')text=canonicalJson({schemaVersion:1,resultId:baseline.result.resultId,revisionId:baseline.result.revisionId,mp4Sha256:baseline.result.mp4Sha256,mp4Bytes:baseline.result.mp4Bytes,qualityPolicy:baseline.result.qualityPolicy,qualityChecks:baseline.result.qualityChecks,createdAt:baseline.result.createdAt})+'\n';
 else if(format==='credits'){
  const sources=[] as {id:string;kind:string;sourceSha256:string;rights:unknown}[];
  for(const item of [...frozen.audioManifest.sources,...frozen.assetManifest.assets.map(asset=>({id:asset.id,kind:'user_supplied',sourceRef:asset.originalRef,rightsRef:asset.rightsRef}))]){
   const rights=(await projects.store.readFresh(item.rightsRef.key)).value;
   if(canonicalHash(rights)!==item.rightsRef.sha256||Buffer.byteLength(canonicalJson(rights))!==item.rightsRef.bytes)throw Error('EXPORT_DOCUMENT_INVALID');
   sources.push({id:item.id,kind:item.kind,sourceSha256:item.sourceRef.sha256,rights});
  }
  text=canonicalJson({schemaVersion:1,revisionId:baseline.result.revisionId,sources,style:frozen.filmSpec.style,runtimeDigest:frozen.filmSpec.runtimeDigest,notice:'These are the frozen source provenance and usage declarations. They do not grant redistribution rights for source assets, fonts, models or third-party software.'})+'\n';
 }else throw Error('CAPABILITY_UNAVAILABLE');
 if(Buffer.byteLength(text)>2*1024*1024)throw Error('EXPORT_DOCUMENT_INVALID');
 assertArchiveText(text);
 const after=await exportBaseline(projects,owner,projectId,sourceArtifactId,root);
 if(after.resultHash!==baseline.resultHash||after.bundle.bundleHash!==baseline.bundle.bundleHash)throw Error('RESULT_STALE');
 const bytes=Buffer.from(text);
 return{bytes,sha256:createHash('sha256').update(bytes).digest('hex'),manifest:{bundleHash:baseline.bundle.bundleHash,revisionId:baseline.bundle.revisionId}};
}
