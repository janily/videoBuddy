import {constants} from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import {lstat,mkdir,open,link,rm,realpath} from 'node:fs/promises';
import {join,resolve,basename} from 'node:path';
import {z} from 'zod';
const Asset=z.strictObject({id:z.uuid(),mime:z.enum(['image/png','image/jpeg','image/webp']),sha256:z.string().regex(/^[a-f0-9]{64}$/),bytes:z.number().int().min(1).max(50*1024*1024)});
export type RuntimeAsset=z.infer<typeof Asset>;
export function runtimeAssets(raw:unknown):RuntimeAsset[]{const parsed=z.array(Asset).max(10).safeParse(raw);if(!parsed.success||new Set(parsed.data.map(a=>a.id)).size!==parsed.data.length)throw Error('RUNTIME_ASSET_INVALID');return parsed.data}
export function runtimeAssetUrl(raw:RuntimeAsset){return '/assets/'+Asset.parse(raw).id+'.bin'}
export function selectedRuntimeAssets(projectId:string,ids:string[],entries:ReadonlyArray<{id:string;originalRef:{key:string;mime:string;sha256:string;bytes:number}}>){
 if(new Set(ids).size!==ids.length)throw Error('RUNTIME_ASSET_INVALID');
 return runtimeAssets(ids.map(id=>{const entry=entries.find(e=>e.id===id);if(!entry||entry.originalRef.key!==`assets/${projectId}/${id}.bin`)throw Error('RUNTIME_ASSET_INVALID');return{id,mime:entry.originalRef.mime,sha256:entry.originalRef.sha256,bytes:entry.originalRef.bytes}}));
}
async function directory(path:string){const info=await lstat(path);if(!info.isDirectory()||info.isSymbolicLink())throw Error('RUNTIME_ASSET_CHANGED')}
async function bytes(path:string,asset:RuntimeAsset){
 let file;try{file=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW)}catch{throw Error('RUNTIME_ASSET_CHANGED')}
 try{const info=await file.stat();if(!info.isFile()||info.nlink!==1||info.size!==asset.bytes)throw Error('RUNTIME_ASSET_CHANGED');const data=await file.readFile();if(data.length!==asset.bytes||createHash('sha256').update(data).digest('hex')!==asset.sha256)throw Error('RUNTIME_ASSET_CHANGED');return data}finally{await file.close()}
}
export async function verifyRuntimeAssets(stageDir:string,raw:unknown){const assets=runtimeAssets(raw);if(!assets.length)return;await directory(stageDir);await directory(join(stageDir,'assets'));for(const asset of assets)await bytes(join(stageDir,'assets',asset.id+'.bin'),asset)}
/** Copies only selected immutable image bytes. No URLs, host paths or credentials
 * are passed to generated code. Existing inputs are verified, never overwritten. */
export async function prepareRuntimeAssets(root:string,projectId:string,stageDir:string,raw:unknown){
 const assets=runtimeAssets(raw);if(!assets.length)return;if(!z.uuid().safeParse(projectId).success)throw Error('RUNTIME_ASSET_INVALID');
 const actualRoot=await realpath(root);if(!/^[a-f0-9]{64}$/.test(basename(stageDir))||resolve(stageDir)!==resolve(root,'media',basename(stageDir)))throw Error('RUNTIME_ASSET_INVALID');
 await directory(join(root,'assets'));await directory(join(root,'assets',projectId));await directory(join(root,'media'));await directory(stageDir);
 if(await realpath(stageDir)!==join(actualRoot,'media',basename(stageDir)))throw Error('RUNTIME_ASSET_CHANGED');
 // Check ALL originals before creating any per-job input.
 for(const asset of assets)await bytes(join(root,'assets',projectId,asset.id+'.bin'),asset);
 const dir=join(stageDir,'assets');await mkdir(dir,{mode:0o700}).catch(error=>{if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error});await directory(dir);
 for(const asset of assets){const target=join(dir,asset.id+'.bin');try{await lstat(target);await bytes(target,asset);continue}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error}
  const data=await bytes(join(root,'assets',projectId,asset.id+'.bin'),asset),temp=join(dir,asset.id+'.'+randomUUID()+'.tmp'),file=await open(temp,'wx',0o600);
  try{await file.writeFile(data);await file.sync();await file.close();try{await link(temp,target)}catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;await bytes(target,asset)}}finally{await file.close().catch(()=>{});await rm(temp,{force:true})}
 }
 const fd=await open(dir,'r');try{await fd.sync()}finally{await fd.close()}await verifyRuntimeAssets(stageDir,assets);
}
