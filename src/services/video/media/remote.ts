import {StringDecoder} from 'node:string_decoder';
import {connect,type Socket} from 'node:net';
import {isAbsolute} from 'node:path';
import type {MediaRuntime,RenderOptions} from './runtime';

export interface OperationScope {projectId:string;operationId:string}
export interface RemoteRuntime extends MediaRuntime {quiesce(scope:OperationScope):Promise<void>}
const MAX_RESPONSE=32*1024*1024;
/** One request per socket: disconnecting cancels the owned render operation. */
export async function createRemoteRuntime(socketPath:string,scope?:OperationScope):Promise<RemoteRuntime>{
 if(!isAbsolute(socketPath)||/[\0\r\n]/.test(socketPath))throw Error('RENDER_CONFIGURATION_INVALID');
 return connectMediaRuntime(()=>connect(socketPath),scope);
}
/** Internal transport adapter, also used for isolated protocol verification. */
export async function connectMediaRuntime(open:()=>Socket,scope?:OperationScope):Promise<RemoteRuntime>{
 const controllers=new Set<AbortController>();let closed=false;
 const call=<T>(method:string,input:unknown,options:RenderOptions={},extra:unknown={})=>new Promise<T>((resolve,reject)=>{
  if(closed||options.signal?.aborted){reject(Error('MEDIA_ABORTED'));return}
  const controller=new AbortController();controllers.add(controller);
  const signal=options.signal?AbortSignal.any([options.signal,controller.signal]):controller.signal;
  const socket=open(),decoder=new StringDecoder('utf8');let buffer='',settled=false,received=0,terminalReceived=false;
  const timer=setTimeout(()=>finish(Error('RENDER_SERVICE_TIMEOUT')),650000);
  const finish=(error?:Error,value?:T)=>{if(settled)return;settled=true;clearTimeout(timer);signal.removeEventListener('abort',abort);controllers.delete(controller);socket.destroy();if(error)reject(error);else resolve(value as T)};
  const abort=()=>finish(Error('MEDIA_ABORTED'));signal.addEventListener('abort',abort,{once:true});
  socket.on('error',()=>finish(Error('RENDER_SERVICE_UNAVAILABLE')));
  socket.on('close',()=>{if(!settled&&!terminalReceived)finish(Error('RENDER_SERVICE_DISCONNECTED'))});
  socket.on('connect',()=>socket.write(JSON.stringify({method,input,options:extra,scope})+'\n'));
  let progress=Promise.resolve();
  socket.on('data',(chunk:Buffer)=>{received+=chunk.length;if(received>MAX_RESPONSE){finish(Error('RENDER_RESPONSE_INVALID'));return}buffer+=decoder.write(chunk);let end:number;
   while((end=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,end);buffer=buffer.slice(end+1);try{
    const message=JSON.parse(line) as {type:string;data?:unknown;error?:string};
    if(message.type==='poster'&&typeof message.data==='string'){const poster=Buffer.from(message.data,'base64');progress=progress.then(()=>options.onPoster?.(poster)).then(()=>{});void progress.catch(()=>finish(Error('POSTER_PUBLICATION_FAILED')))}
    else if(message.type==='result'){terminalReceived=true;void progress.then(()=>finish(undefined,message.data as T)).catch(()=>{})}
    else if(message.type==='error')finish(Error(typeof message.error==='string'?message.error:'RENDER_FAILED'));
    else finish(Error('RENDER_RESPONSE_INVALID'));
   }catch{finish(Error('RENDER_RESPONSE_INVALID'))}}
  });
 });
 const info=await call<Pick<MediaRuntime,'version'|'runtimeDigest'>>('info',null);
 if(!/^[a-f0-9]{64}$/.test(info.runtimeDigest)||!info.version)throw Error('RENDER_RESPONSE_INVALID');
 return{...info,quiesce:async input=>{await call('quiesce',input)},renderShot:(job,options)=>call('renderShot',job,options),assemble:(input,options)=>call('assemble',input,options),prepareImage:(input,options)=>call('prepareImage',input,options),probe:(path,options)=>call('probe',path,options,{fullDecode:options?.fullDecode,expected:options?.expected}),close:async()=>{closed=true;for(const controller of controllers)controller.abort()}};
}
