import {it,expect} from 'vitest';
import {mkdtemp,mkdir,readFile,writeFile,symlink,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {prepareRuntimeAssets,runtimeAssetUrl,verifyRuntimeAssets} from '@/services/video/media/runtime-assets';
import {computeStageKey} from '@/services/video/media/runtime';
const png=Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489','hex');
const digest=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
async function fixture(){const root=await mkdtemp(join(tmpdir(),'vb-assets-')),projectId=randomUUID(),id=randomUUID(),stage=join(root,'media','a'.repeat(64));await mkdir(join(root,'assets',projectId),{recursive:true});await mkdir(stage,{recursive:true});await writeFile(join(root,'assets',projectId,id+'.bin'),png);return{root,projectId,id,stage,asset:{id,mime:'image/png' as const,sha256:digest(png),bytes:png.length}}}
it('copies exact authorized image bytes into isolated immutable inputs and revalidates on recovery',async()=>{
 const f=await fixture();try{await prepareRuntimeAssets(f.root,f.projectId,f.stage,[f.asset]);expect(await readFile(join(f.stage,'assets',f.id+'.bin'))).toEqual(png);expect(runtimeAssetUrl(f.asset)).toBe('/assets/'+f.id+'.bin');await verifyRuntimeAssets(f.stage,[f.asset]);await prepareRuntimeAssets(f.root,f.projectId,f.stage,[f.asset]);await writeFile(join(f.stage,'assets',f.id+'.bin'),Buffer.concat([png,Buffer.from('changed')]));await expect(verifyRuntimeAssets(f.stage,[f.asset])).rejects.toThrow('RUNTIME_ASSET_CHANGED');await expect(prepareRuntimeAssets(f.root,f.projectId,f.stage,[f.asset])).rejects.toThrow('RUNTIME_ASSET_CHANGED')}finally{await rm(f.root,{recursive:true,force:true})}
});
it('rejects changed originals, unsupported files and duplicate or escaping inputs before copying',async()=>{
 const f=await fixture();try{await expect(prepareRuntimeAssets(f.root,f.projectId,f.stage,[{...f.asset,sha256:'b'.repeat(64)}])).rejects.toThrow('RUNTIME_ASSET_CHANGED');for(const list of [[{...f.asset,mime:'text/markdown'}],[f.asset,f.asset],[{...f.asset,id:'../secret'}]])await expect(prepareRuntimeAssets(f.root,f.projectId,f.stage,list)).rejects.toThrow('RUNTIME_ASSET_INVALID');await expect(readFile(join(f.stage,'assets',f.id+'.bin'))).rejects.toThrow()}finally{await rm(f.root,{recursive:true,force:true})}
});
it('rejects symlinked input directories without writing through them',async()=>{
 const f=await fixture();try{const foreign=join(f.root,'foreign');await mkdir(foreign);await symlink(foreign,join(f.stage,'assets'));await expect(prepareRuntimeAssets(f.root,f.projectId,f.stage,[f.asset])).rejects.toThrow('RUNTIME_ASSET_CHANGED');await expect(readFile(join(foreign,f.id+'.bin'))).rejects.toThrow()}finally{await rm(f.root,{recursive:true,force:true})}
});
it('binds asset identities and bytes to render stage keys while retaining legacy empty jobs',()=>{
 const base={projectId:randomUUID(),bundleHash:'b'.repeat(64),runtimeDigest:'c'.repeat(64),sourceHtml:'scene',logicalWidth:320,logicalHeight:180,outputWidth:320,outputHeight:180,fps:24 as const,startFrame:0,endFrame:24,seed:1,fence:1},asset={id:randomUUID(),mime:'image/png' as const,sha256:digest(png),bytes:png.length};
 expect(computeStageKey({...base,assets:[]})).toBe(computeStageKey(base));expect(computeStageKey({...base,assets:[asset]})).not.toBe(computeStageKey(base));expect(computeStageKey({...base,assets:[{...asset,sha256:'d'.repeat(64)}]})).not.toBe(computeStageKey({...base,assets:[asset]}));
});
