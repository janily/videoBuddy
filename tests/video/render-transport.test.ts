import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {connect} from 'node:net';
import {randomUUID} from 'node:crypto';
import {connectMediaRuntime} from '@/services/video/media/remote';
import {createRenderServer,startRenderServer} from '@/services/video/media/render-server';
import type {MediaRuntime,MediaJob} from '@/services/video/media/runtime';
const cleanup:Array<()=>Promise<unknown>>=[];
afterEach(async()=>{for(const work of cleanup.reverse())await work();cleanup.length=0});
async function fixture(renderShot=vi.fn()){
 const root=await mkdtemp(join(tmpdir(),'vb-rpc-'));cleanup.push(()=>rm(root,{recursive:true,force:true}));
 const path=join(root,'render.sock'),runtime={runtimeDigest:'a'.repeat(64),version:{sandbox:true},renderShot,assemble:vi.fn(),prepareImage:vi.fn(),probe:vi.fn(),close:vi.fn()} as unknown as MediaRuntime;
 const service=createRenderServer(runtime);await new Promise<void>(resolve=>service.server.listen(0,'127.0.0.1',resolve));cleanup.push(()=>service.close());const address=service.server.address();if(!address||typeof address==='string')throw Error('TEST_ADDRESS');return{path,runtime,client:(scope:{projectId:string;operationId:string}={projectId:randomUUID(),operationId:randomUUID()})=>connectMediaRuntime(()=>connect(address.port,'127.0.0.1'),scope)};
}
describe('isolated render transport',()=>{
 it('forwards poster progress before completing',async()=>{
  const {client:open}=await fixture(vi.fn(async(_job,options)=>{await options.onPoster(Buffer.from('poster'));return{key:'completed'}}));
  const client=await open(),posters:string[]=[];
  expect(await client.renderShot({} as MediaJob,{onPoster:async data=>{await new Promise(resolve=>setTimeout(resolve,100));posters.push(data.toString())}})).toEqual({key:'completed'});
  expect(posters).toEqual(['poster']);await client.close();
 });
 it('disconnect cancels the exact active job promptly',async()=>{
  let cancelled=false;const {client:open}=await fixture(vi.fn((_job,options)=>new Promise((_resolve,reject)=>options.signal.addEventListener('abort',()=>{cancelled=true;reject(Error('MEDIA_ABORTED'))}))));
  const client=await open(),abort=new AbortController();const request=client.renderShot({} as MediaJob,{signal:abort.signal});
  await new Promise(resolve=>setTimeout(resolve,30));abort.abort();await expect(request).rejects.toThrow('MEDIA_ABORTED');
  await vi.waitFor(()=>expect(cancelled).toBe(true),{timeout:1000});await client.close();
 });
 it('does not expose internal paths or credential-bearing errors',async()=>{
  const {client:open}=await fixture(vi.fn(async()=>{throw Error('RENDER_FAILED: /private/config SECRET=value')}));
  const client=await open();await expect(client.renderShot({} as MediaJob)).rejects.toThrow(/^RENDER_FAILED$/);await client.close();
 });
 it('refuses to replace another server socket',async()=>{
  const {path,runtime}=await fixture();await import('node:fs/promises').then(fs=>fs.writeFile(path,'existing'));await expect(startRenderServer(runtime,path)).rejects.toThrow('RENDER_SOCKET_EXISTS');
 });
});

it('quiesce waits for owned cleanup and fences delayed old submissions',async()=>{
 let stopped=false;const {client:open}=await fixture(vi.fn((_job,options)=>new Promise((_resolve,reject)=>options.signal.addEventListener('abort',()=>{setTimeout(()=>{stopped=true;reject(Error('MEDIA_ABORTED'))},40)}))));
 const scope={projectId:randomUUID(),operationId:randomUUID()},client=await open(scope),recovery=await open();
 const active=client.renderShot({...scope} as MediaJob);const failed=expect(active).rejects.toThrow('MEDIA_ABORTED');
 await new Promise(resolve=>setTimeout(resolve,20));await recovery.quiesce(scope);expect(stopped).toBe(true);await failed;
 await expect(client.renderShot({...scope} as MediaJob)).rejects.toThrow('MEDIA_ABORTED');await client.close();await recovery.close();
});
