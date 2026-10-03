import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {ProjectControl} from '@/contracts/video/project';
import {Understanding} from '@/contracts/video/domain';
import {ProjectStore} from '@/services/video/storage/project-store';
import {updateJson} from '@/services/video/storage/atomic-store';
import {probeMarkdown} from './probe';

export interface TextAnalysis{schemaVersion:5;assetId:string;mime:'text/markdown'|'application/pdf'|'audio/wav'|'audio/mpeg'|'audio/mp4';sha256:string;text:string;pages?:string[];segments?:Array<{startMs:number;endMs:number;text:string;language?:'zh-CN'|'en'}>;language?:'zh-CN'|'en'|'mixed';durationMs?:number;asrRuntimeDigest?:string;mediaRuntimeDigest?:string;wavChunks?:Array<{startMs:number;sha256:string}>;chunkCount?:number;trust:'untrusted_material'}
export async function publishMarkdownAnalysis(projects:ProjectStore,projectId:string,assetId:string,path:string){
 const parsed=probeMarkdown(await readFile(path));
 const record:TextAnalysis={schemaVersion:5,assetId,mime:'text/markdown',sha256:parsed.sha256,text:parsed.text,trust:parsed.trust};
 const prefix=`projects/${projectId}`;
 const ref=await projects.index.immutable(`${prefix}/assets/${assetId}/analysis/${parsed.sha256}`,record);
 const next=await updateJson(projects.store,`${prefix}/control`,async(control:ProjectControl)=>{
  if(control.deletedAt)throw Error('ACCESS_NOT_FOUND');if(!Number.isFinite(Date.parse(control.expiresAt))||Date.parse(control.expiresAt)<=Date.now())throw Error('PROJECT_EXPIRED');
  const asset=control.assets.find(item=>item.id===assetId);
  if(!asset||asset.declaredMime!=='text/markdown'||asset.sha256!==parsed.sha256)throw Error('ASSET_HASH_CONFLICT');
  if(asset.status==='ready'){if(asset.analysisRef?.sha256!==ref.sha256)throw Error('ASSET_HASH_CONFLICT');return control}
  if(asset.status!=='uploaded')throw Error('ASSET_INVALID');
  const understanding=(await projects.store.readFresh<Understanding>(control.understandingRef.key)).value;
  const briefVersion=control.briefVersion+1;
  const updated:Understanding={...understanding,briefVersion,assetUses:understanding.assetUses.filter(use=>use.assetId!==assetId).concat({assetId,purpose:asset.intendedUse,required:false})};
  const understandingRef=await projects.index.immutable(`${prefix}/understanding/${briefVersion}/${randomUUID()}`,updated);
  const assets=control.assets.map(item=>item.id===assetId?{...item,status:'ready',analysisRef:ref}:item);
  return{...control,controlVersion:control.controlVersion+1,briefVersion,understandingRef,assets,inputPending:assets.some(item=>['reserved','uploading','uploaded','analyzing'].includes(item.status)),previewState:control.previewState==='ready'?'stale':control.previewState};
 });
 return next.assets.find(item=>item.id===assetId)!;
}
export async function publishPdfAnalysis(projects:ProjectStore,projectId:string,assetId:string,pages:string[]){
 const prefix=`projects/${projectId}`;
 const control=(await projects.store.readFresh<ProjectControl>(`${prefix}/control`)).value;
 const asset=control.assets.find(item=>item.id===assetId);
 if(!asset||asset.declaredMime!=='application/pdf'||!asset.sha256||!['uploaded','analyzing','ready'].includes(asset.status))throw Error('ASSET_INVALID');
 const text=pages.map((page,index)=>`[page:${index+1}] ${page}`).join('\n');
 const record:TextAnalysis={schemaVersion:5,assetId,mime:'application/pdf',sha256:asset.sha256,text,pages,trust:'untrusted_material'};
 const ref=await projects.index.immutable(`${prefix}/assets/${assetId}/analysis/${asset.sha256}`,record);
 const next=await updateJson(projects.store,`${prefix}/control`,async(current:ProjectControl)=>{
  if(current.deletedAt)throw Error('ACCESS_NOT_FOUND');if(!Number.isFinite(Date.parse(current.expiresAt))||Date.parse(current.expiresAt)<=Date.now())throw Error('PROJECT_EXPIRED');
  const found=current.assets.find(item=>item.id===assetId);
  if(!found||found.sha256!==record.sha256)throw Error('ASSET_HASH_CONFLICT');
  if(found.status==='ready'){if(found.analysisRef?.sha256!==ref.sha256)throw Error('ASSET_HASH_CONFLICT');return current}
  if(!['uploaded','analyzing'].includes(found.status))throw Error('ASSET_INVALID');
  const understanding=(await projects.store.readFresh<Understanding>(current.understandingRef.key)).value;
  const briefVersion=current.briefVersion+1;
  const updated:Understanding={...understanding,briefVersion,assetUses:understanding.assetUses.filter(use=>use.assetId!==assetId).concat({assetId,purpose:found.intendedUse,required:false})};
  const understandingRef=await projects.index.immutable(`${prefix}/understanding/${briefVersion}/${randomUUID()}`,updated);
  const assets=current.assets.map(item=>item.id===assetId?{...item,status:'ready',analysisRef:ref}:item);
  return{...current,controlVersion:current.controlVersion+1,briefVersion,understandingRef,assets,inputPending:assets.some(item=>['reserved','uploading','uploaded','analyzing'].includes(item.status)),previewState:current.previewState==='ready'?'stale':current.previewState};
 });
 return next.assets.find(item=>item.id===assetId)!;
}
export async function publishAudioAnalysis(projects:ProjectStore,projectId:string,assetId:string,transcript:{durationMs:number;language:'zh-CN'|'en'|'mixed';segments:Array<{startMs:number;endMs:number;text:string;language:'zh-CN'|'en'}>;asrRuntimeDigest:string;mediaRuntimeDigest:string;wavChunks:Array<{startMs:number;sha256:string}>;chunkCount:number}){
 const prefix=`projects/${projectId}`;
 const control=(await projects.store.readFresh<ProjectControl>(`${prefix}/control`)).value;
 const asset=control.assets.find(item=>item.id===assetId);
 if(!asset||!['audio/wav','audio/mpeg','audio/mp4'].includes(asset.declaredMime)||!asset.sha256||!['uploaded','analyzing','ready'].includes(asset.status))throw Error('ASSET_INVALID');
 const text=transcript.segments.map(segment=>`[${segment.startMs}-${segment.endMs}ms] ${segment.text}`).join('\n');
 if(!text||Buffer.byteLength(text)>40000||transcript.segments.some(segment=>segment.endMs>transcript.durationMs+1000))throw Error('AUDIO_TEXT_UNAVAILABLE');
 const record:TextAnalysis={schemaVersion:5,assetId,mime:asset.declaredMime as TextAnalysis['mime'],sha256:asset.sha256,text,segments:transcript.segments,language:transcript.language,durationMs:transcript.durationMs,asrRuntimeDigest:transcript.asrRuntimeDigest,mediaRuntimeDigest:transcript.mediaRuntimeDigest,wavChunks:transcript.wavChunks,chunkCount:transcript.chunkCount,trust:'untrusted_material'};
 const ref=await projects.index.immutable(`${prefix}/assets/${assetId}/analysis/${asset.sha256}`,record);
 const next=await updateJson(projects.store,`${prefix}/control`,async(current:ProjectControl)=>{
  if(current.deletedAt)throw Error('ACCESS_NOT_FOUND');if(!Number.isFinite(Date.parse(current.expiresAt))||Date.parse(current.expiresAt)<=Date.now())throw Error('PROJECT_EXPIRED');
  const found=current.assets.find(item=>item.id===assetId);
  if(!found||found.sha256!==record.sha256)throw Error('ASSET_HASH_CONFLICT');
  if(found.status==='ready'){if(found.analysisRef?.sha256!==ref.sha256)throw Error('ASSET_HASH_CONFLICT');return current}
  if(!['uploaded','analyzing'].includes(found.status))throw Error('ASSET_INVALID');
  const understanding=(await projects.store.readFresh<Understanding>(current.understandingRef.key)).value;
  const briefVersion=current.briefVersion+1;
  const updated:Understanding={...understanding,briefVersion,assetUses:understanding.assetUses.filter(use=>use.assetId!==assetId).concat({assetId,purpose:found.intendedUse,required:false})};
  const understandingRef=await projects.index.immutable(`${prefix}/understanding/${briefVersion}/${randomUUID()}`,updated);
  const assets=current.assets.map(item=>item.id===assetId?{...item,status:'ready',analysisRef:ref}:item);
  return{...current,controlVersion:current.controlVersion+1,briefVersion,understandingRef,assets,inputPending:assets.some(item=>['reserved','uploading','uploaded','analyzing'].includes(item.status)),previewState:current.previewState==='ready'?'stale':current.previewState};
 });
 return next.assets.find(item=>item.id===assetId)!;
}
