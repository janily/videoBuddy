import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {ProjectControl} from '@/contracts/video/project';
import {Understanding} from '@/contracts/video/domain';
import {ProjectStore} from '@/services/video/storage/project-store';
import {updateJson} from '@/services/video/storage/atomic-store';
import {probeMarkdown} from './probe';

export interface MarkdownAnalysis{schemaVersion:5;assetId:string;mime:'text/markdown';sha256:string;text:string;trust:'untrusted_material'}
export async function publishMarkdownAnalysis(projects:ProjectStore,projectId:string,assetId:string,path:string){
 const parsed=probeMarkdown(await readFile(path));
 const record:MarkdownAnalysis={schemaVersion:5,assetId,mime:'text/markdown',sha256:parsed.sha256,text:parsed.text,trust:parsed.trust};
 const prefix=`projects/${projectId}`;
 const ref=await projects.index.immutable(`${prefix}/assets/${assetId}/analysis/${parsed.sha256}`,record);
 const next=await updateJson(projects.store,`${prefix}/control`,async(control:ProjectControl)=>{
  if(control.deletedAt)throw Error('ACCESS_NOT_FOUND');
  const asset=control.assets.find(item=>item.id===assetId);
  if(!asset||asset.declaredMime!=='text/markdown'||asset.sha256!==parsed.sha256)throw Error('ASSET_HASH_CONFLICT');
  if(asset.status==='ready'){if(asset.analysisRef?.sha256!==ref.sha256)throw Error('ASSET_HASH_CONFLICT');return control}
  if(asset.status!=='uploaded')throw Error('ASSET_INVALID');
  const understanding=(await projects.store.readFresh<Understanding>(control.understandingRef.key)).value;
  const briefVersion=control.briefVersion+1;
  const updated:Understanding={...understanding,briefVersion,assetUses:understanding.assetUses.filter(use=>use.assetId!==assetId).concat({assetId,purpose:asset.intendedUse,required:false})};
  const understandingRef=await projects.index.immutable(`${prefix}/understanding/${briefVersion}/${randomUUID()}`,updated);
  const assets=control.assets.map(item=>item.id===assetId?{...item,status:'ready',analysisRef:ref}:item);
  const now=new Date().toISOString();
  return{...control,controlVersion:control.controlVersion+1,briefVersion,understandingRef,assets,inputPending:assets.some(item=>['reserved','uploading','uploaded','analyzing'].includes(item.status)),previewState:control.previewState==='ready'?'stale':control.previewState,lastUserActivityAt:now,expiresAt:new Date(Date.parse(now)+30*86400000).toISOString()};
 });
 return next.assets.find(item=>item.id===assetId)!;
}
