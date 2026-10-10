import {join,resolve} from 'node:path';
import {availableParallelism} from 'node:os';
import type {MediaRuntime,MediaOptions} from '../runtime';
import {loadRuntimeFonts,runtimeVersion} from '../runtime-version';
import {BrowserPool,runtimeLaunchOptions} from './browser';
import {mediaBinaries,runProcess,assertNotAborted} from './ffmpeg';
import {privateDirectory} from './files';
import {renderShot,requireRuntimePath,type LocalContext} from './renderer';
import {assemble} from './assemble';
import {probeVideo} from './probe';
import {prepareImage} from './image';
export interface LocalRuntimeOptions {root:string;env?:Record<string,string|undefined>;fontsDir?:string;frameFormat?:'jpeg'|'png';frameTimeoutMs?:number;timeoutMs?:number;concurrency?:number}
export async function createLocalRuntime(options:LocalRuntimeOptions):Promise<MediaRuntime>{
 const env=options.env||process.env,launch=runtimeLaunchOptions(env),root=resolve(options.root),pool=new BrowserPool(env),binaries=mediaBinaries(env),frameFormat=options.frameFormat||'png';
 // PNG is the quality-preserving default until the measured P0 gate approves JPEG.
 if(!['png','jpeg'].includes(frameFormat))throw Error('RENDER_CONFIGURATION_INVALID');
 await privateDirectory(root);const {fonts,lockHash}=await loadRuntimeFonts(options.fontsDir||join(process.cwd(),'runtime/fonts'));
 let context:LocalContext;
 try{const browser=await pool.get(),ffmpeg=(await runProcess(binaries.ffmpeg,['-version'],{timeoutMs:10000,env})).stdout.split('\n')[0];if(!/^ffmpeg version (?:[6-9]|[1-9][0-9])\./.test(ffmpeg))throw Error('FFMPEG_VERSION_UNSUPPORTED');
  const version=await runtimeVersion(browser.version(),ffmpeg,lockHash,frameFormat,launch.chromiumSandbox);
  context={root,musicRoot:resolve(env.VIDEO_MUSIC_DIR||join(root,'media','music')),pool,fonts,...version,...binaries,frameFormat,frameTimeoutMs:options.frameTimeoutMs??5000,timeoutMs:options.timeoutMs??600000};
 }catch(error){await pool.close();throw error}
 const limit=options.concurrency??Math.max(1,Math.min(4,Math.floor(availableParallelism()/2)));if(!Number.isInteger(limit)||limit<1||limit>4||!Number.isSafeInteger(context.frameTimeoutMs)||context.frameTimeoutMs<1||!Number.isSafeInteger(context.timeoutMs)||context.timeoutMs<1){await pool.close();throw Error('RENDER_CONFIGURATION_INVALID')}
 const closing=new AbortController();let active=0;const waiters:Array<()=>void>=[],running=new Set<Promise<unknown>>();
 const run=<T>(operation:(options:MediaOptions)=>Promise<T>,input:MediaOptions={})=>{
  const signal=input.signal?AbortSignal.any([input.signal,closing.signal]):closing.signal;
  const task=(async()=>{assertNotAborted(signal);while(active>=limit){await new Promise<void>((resolve,reject)=>{const wake=()=>{signal.removeEventListener('abort',abort);resolve()},abort=()=>{const i=waiters.indexOf(wake);if(i>=0)waiters.splice(i,1);reject(Error('MEDIA_ABORTED'))};waiters.push(wake);signal.addEventListener('abort',abort,{once:true})});assertNotAborted(signal)}active++;try{return await operation({signal})}finally{active--;waiters.shift()?.()}})();
  running.add(task);void task.finally(()=>running.delete(task)).catch(()=>{});return task;
 };
 return{runtimeDigest:context.runtimeDigest,version:context.version,
  renderShot:(job,input={})=>run(merged=>renderShot(context,job,{...input,...merged}),input),
  assemble:(input,options)=>run(merged=>assemble(context,input,merged),options),
  probe:(path,input={})=>run(merged=>{requireRuntimePath(join(root,'media'),path);return probeVideo(path,context.ffprobe,{...input,...merged})},input),
  prepareImage:(input,options)=>run(merged=>prepareImage(context,input,merged),options),
  close:async()=>{closing.abort();await pool.close();await Promise.allSettled([...running])},
 };
}
