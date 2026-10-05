import {it,expect} from 'vitest';
import {createHash,randomUUID} from 'node:crypto';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createRuntimeAssetServer,verifyRuntimeAssetInputs} from '../../runtime/media/runtime-assets.mjs';
it('serves only the exact declared byte graph and blocks foreign or changed files over real HTTP',async()=>{
 const root=await mkdtemp(join(tmpdir(),'vb-asset-server-')),id=randomUUID(),data=Buffer.from('owned immutable image'),asset={id,mime:'image/png',bytes:data.length,sha256:createHash('sha256').update(data).digest('hex')};let server:ReturnType<typeof createRuntimeAssetServer>|undefined;
 try{await mkdir(join(root,'assets'));await writeFile(join(root,'scene.html'),'<html>scene</html>');await writeFile(join(root,'assets',id+'.bin'),data);await writeFile(join(root,'assets','foreign.bin'),'foreign private data');await verifyRuntimeAssetInputs(root,[asset]);server=createRuntimeAssetServer(root,[asset]);await new Promise<void>(resolve=>server!.listen(0,'127.0.0.1',resolve));const address=server.address();if(!address||typeof address==='string')throw Error('SERVER_ADDRESS');const base='http://127.0.0.1:'+address.port;
 const response=await fetch(base+'/assets/'+id+'.bin');expect(response.status).toBe(200);expect(response.headers.get('content-type')).toBe('image/png');expect(Buffer.from(await response.arrayBuffer())).toEqual(data);
 for(const path of ['/assets/foreign.bin','/assets/'+randomUUID()+'.bin','/job.json','/assets/%2e%2e/job.json'])expect((await fetch(base+path)).status).toBe(404);
 expect((await fetch(base+'/scene.html')).status).toBe(200);expect((await fetch(base+'/assets/'+id+'.bin',{method:'POST'})).status).toBe(404);
 await writeFile(join(root,'assets',id+'.bin'),'tampered');expect((await fetch(base+'/assets/'+id+'.bin')).status).toBe(404);await expect(verifyRuntimeAssetInputs(root,[asset])).rejects.toThrow('RUNTIME_ASSET_CHANGED');
 }finally{if(server)await new Promise<void>(resolve=>server!.close(()=>resolve()));await rm(root,{recursive:true,force:true})}
});
