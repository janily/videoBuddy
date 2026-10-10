import {z} from 'zod';
import {StringDecoder} from 'node:string_decoder';
import {createServer,type Socket} from 'node:net';
import {chmod,lstat,unlink} from 'node:fs/promises';
import type {MediaRuntime} from './runtime';

const MAX_REQUEST=4*1024*1024;
/** Filesystem permissions authenticate callers; no web endpoint exposes this RPC. */
export async function startRenderServer(runtime:MediaRuntime,socketPath:string){
 // Refuse an existing socket: never unlink a live worker's address.
 try{await lstat(socketPath);throw Error('RENDER_SOCKET_EXISTS')}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error}
 const service=createRenderServer(runtime);
 await new Promise<void>((resolve,reject)=>{service.server.once('error',reject);service.server.listen(socketPath,()=>{service.server.removeListener('error',reject);resolve()})});
 await chmod(socketPath,0o660);
 return{close:async()=>{await service.close();await unlink(socketPath).catch(error=>{if(error.code!=='ENOENT')throw error})}};
}
/** RPC protocol separated from its production Unix-domain socket listener. */
export function createRenderServer(runtime:MediaRuntime){
 const sockets=new Set<Socket>(),operations=new Set<Promise<void>>();
 const scopeSchema=z.strictObject({projectId:z.uuid(),operationId:z.uuid()});
 const revoked=new Set<string>(),jobs=new Map<string,Set<{controller:AbortController;done:Promise<void>}>>();
 const scopeKey=(raw:unknown)=>{const scope=scopeSchema.parse(raw);return scope.projectId+'/'+scope.operationId};
 const server=createServer(socket=>{
  sockets.add(socket);const controller=new AbortController();const decoder=new StringDecoder('utf8');let buffer='',bytes=0,started=false;
  socket.setTimeout(650000,()=>socket.destroy());socket.on('error',()=>{});
  socket.on('close',()=>{controller.abort();sockets.delete(socket)});
  const send=(value:unknown)=>new Promise<void>((resolve,reject)=>{if(socket.destroyed){reject(Error('MEDIA_ABORTED'));return}socket.write(JSON.stringify(value)+'\n',error=>error?reject(error):resolve())});
  socket.on('data',(chunk:Buffer)=>{
   if(started){socket.destroy();return}bytes+=chunk.length;if(bytes>MAX_REQUEST){socket.destroy();return}buffer+=decoder.write(chunk);const end=buffer.indexOf('\n');if(end<0)return;
   if(buffer.slice(end+1).trim()){socket.destroy();return}started=true;
   let release:(()=>void)|undefined;
   const operation=(async()=>{try{
    const request=JSON.parse(buffer.slice(0,end));buffer='';let result:unknown;const options={signal:controller.signal};
    if(request.method==='quiesce'){
     const key=scopeKey(request.input);revoked.add(key);const active=[...(jobs.get(key)||[])];for(const job of active)job.controller.abort();await Promise.allSettled(active.map(job=>job.done));result={stopped:true};
    }else{
     if(['renderShot','assemble','prepareImage'].includes(request.method)&&!request.scope)throw Error('RENDER_SCOPE_INVALID');
     if(request.scope&&request.method!=='info'){
      const key=scopeKey(request.scope);if(revoked.has(key))throw Error('MEDIA_ABORTED');
      if(request.input?.projectId&&request.input.projectId!==request.scope.projectId||request.input?.operationId&&request.input.operationId!==request.scope.operationId)throw Error('RENDER_SCOPE_INVALID');
      let resolveDone:()=>void=()=>{};const job={controller,done:new Promise<void>(resolve=>{resolveDone=resolve})};const active=jobs.get(key)||new Set();active.add(job);jobs.set(key,active);release=()=>{active.delete(job);if(!active.size)jobs.delete(key);resolveDone()};
     }
    switch(request.method){
     case 'info':result={runtimeDigest:runtime.runtimeDigest,version:runtime.version};break;
     case 'renderShot':result=await runtime.renderShot(request.input,{...options,onPoster:buffer=>send({type:'poster',data:buffer.toString('base64')})});break;
     case 'assemble':result=await runtime.assemble(request.input,options);break;
     case 'prepareImage':result=await runtime.prepareImage(request.input,options);break;
     case 'probe':if(typeof request.input!=='string')throw Error('MEDIA_PATH_INVALID');result=await runtime.probe(request.input,{...request.options,...options});break;
     default:throw Error('RENDER_METHOD_INVALID');
    }
    }
    await send({type:'result',data:result});
   }catch(error){const raw=error instanceof Error?error.message:'RENDER_FAILED';const code=/^[A-Z][A-Z0-9_]+/.exec(raw)?.[0]||'RENDER_FAILED';await send({type:'error',error:code}).catch(()=>{})}
   finally{release?.();socket.end()}})();operations.add(operation);void operation.finally(()=>operations.delete(operation));
  });
 });
 return{server,close:async()=>{const stopped=new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));for(const socket of sockets)socket.destroy();await Promise.allSettled([...operations]);await stopped}};
}
