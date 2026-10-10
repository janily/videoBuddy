import {chromium,type Browser,type BrowserContext,type BrowserServer} from 'playwright';
import {sanitizedEnvironment} from './environment';
export {sanitizedEnvironment} from './environment';
export function runtimeLaunchOptions(env:Record<string,string|undefined>=process.env){
 const unsafe=env.VIDEO_UNSAFE_NO_SANDBOX==='1';
 if(env.VIDEO_CHROMIUM_EXECUTABLE_PATH&&!(unsafe&&env.NODE_ENV==='development'))throw Error('SANDBOX_REQUIRED: executable override is development-only');
 if(unsafe&&env.NODE_ENV!=='development')throw Error('SANDBOX_REQUIRED: unsafe escape is development-only');
 return{...(env.VIDEO_CHROMIUM_EXECUTABLE_PATH?{executablePath:env.VIDEO_CHROMIUM_EXECUTABLE_PATH}:{}),headless:true,chromiumSandbox:!unsafe,host:'127.0.0.1',env:sanitizedEnvironment(env),timeout:30000,
  args:['--disable-dev-shm-usage','--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1','--force-webrtc-ip-handling-policy=disable_non_proxied_udp','--disable-background-networking','--disable-extensions','--js-flags=--max-old-space-size=1024',...(unsafe?['--no-sandbox']:[])]};
}
/** One browser per runtime, fresh cookie/storage/process-isolated context per job.
 * launchServer exposes a trusted process handle for hard timeout cleanup. */
export class BrowserPool{
 private server?:BrowserServer;private browser?:Browser;private launching?:Promise<Browser>;private closed=false;private epoch=0;private count=0;private contexts=new Set<BrowserContext>();private releases=new WeakMap<BrowserContext,Promise<void>>();
 constructor(private env:Record<string,string|undefined>=process.env){runtimeLaunchOptions(env)}
 async get():Promise<Browser>{
  if(this.closed)throw Error('RUNTIME_CLOSED');if(this.browser?.isConnected())return this.browser;if(this.launching)return this.launching;
  const epoch=this.epoch;
  this.launching=(async()=>{const options=runtimeLaunchOptions(this.env);if(!options.chromiumSandbox)process.emitWarning('UNSAFE DEVELOPMENT RENDER: Chromium sandbox is explicitly disabled. Never use this configuration in production.');
   try{const server=await chromium.launchServer(options);if(this.closed||epoch!==this.epoch){await server.kill();throw Error('MEDIA_ABORTED')}this.server=server;const browser=await chromium.connect(server.wsEndpoint());if(this.closed||epoch!==this.epoch){await server.kill();throw Error('MEDIA_ABORTED')}this.browser=browser;return browser}
   catch(error){await this.reset();throw Error(`CHROMIUM_SANDBOX_UNAVAILABLE: ${error instanceof Error?error.message.slice(0,500):'launch failed'}`)}
  })();try{return await this.launching}finally{this.launching=undefined}
 }
 async context(width=640,height=480){
  const browser=await this.get(),context=await browser.newContext({viewport:{width,height},deviceScaleFactor:1,serviceWorkers:'block',acceptDownloads:false,permissions:[],locale:'zh-CN',timezoneId:'UTC',colorScheme:'light',reducedMotion:'reduce'});
  // WebRTC is outside ordinary fetch routing; remove its constructors before
  // any generated script runs, in addition to the Chromium UDP policy.
  this.contexts.add(context);
  try{await context.addInitScript(()=>{for(const name of ['RTCPeerConnection','webkitRTCPeerConnection'])Object.defineProperty(window,name,{value:undefined,writable:false,configurable:false})});return context}
  catch(error){await this.release(context);throw error}
 }
 release(context:BrowserContext):Promise<void>{
  const existing=this.releases.get(context);if(existing)return existing;
  const closing=(async()=>{
   this.contexts.delete(context);
   let timer:ReturnType<typeof setTimeout>|undefined;
   // A normal cancellation only closes its context. Escalate if Chromium
   // cannot close it promptly (for example, an unresponsive renderer).
   try{await Promise.race([context.close().catch(()=>{}),new Promise<void>(resolve=>{timer=setTimeout(()=>{void this.reset().finally(resolve)},500)})])}finally{if(timer)clearTimeout(timer)}
   if(++this.count>=50&&this.contexts.size===0){this.count=0;await this.reset()}
  })();this.releases.set(context,closing);return closing;
 }
 async reset(){this.epoch++;const server=this.server;this.server=undefined;this.browser=undefined;this.contexts.clear();await server?.kill().catch(()=>{})}
 async close(){this.closed=true;await this.reset();await this.launching?.catch(()=>{});await this.reset()}
}
export async function browserDeadline<T>(work:()=>Promise<T>,pool:BrowserPool,timeoutMs:number,signal?:AbortSignal,code='RENDER_FRAME_TIMEOUT',owner?:BrowserContext):Promise<T>{
 if(signal?.aborted){if(owner)await pool.release(owner);throw Error('MEDIA_ABORTED')}
 let timer:ReturnType<typeof setTimeout>|undefined,stopped:string|undefined,cleanup:Promise<void>|undefined;let onAbort:()=>void=()=>{};
 try{
  const result=await Promise.race([Promise.resolve().then(work),new Promise<never>((_,reject)=>{
   const fail=(reason:string,aborted=false)=>{
    if(stopped)return;stopped=reason;if(timer)clearTimeout(timer);
    // Context creation may still be pending. Its caller closes a context
    // arriving after cancellation; never reset unrelated work in that case.
    cleanup=aborted?(owner?pool.release(owner):Promise.resolve()):pool.reset();
    void cleanup.then(()=>reject(Error(reason)),()=>reject(Error(reason)));
   };
   timer=setTimeout(()=>fail(code),timeoutMs);onAbort=()=>fail('MEDIA_ABORTED',true);signal?.addEventListener('abort',onAbort,{once:true});
  })]);
  if(stopped)throw Error(stopped);return result;
 }catch(error){if(stopped){await cleanup?.catch(()=>{});throw Error(stopped)}throw error}
 finally{if(timer)clearTimeout(timer);signal?.removeEventListener('abort',onAbort)}
}
