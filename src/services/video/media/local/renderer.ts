import {rm,rename} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {z} from 'zod';
import {canonicalHash} from '@/services/video/domain/hash';
import {runtimeAssets} from '../runtime-assets';
import {computeStageKey,type MediaJob,type RenderOptions,type RenderedVideo} from '../runtime';
import type {RuntimeFont,RuntimeVersion} from '../runtime-version';
import {BrowserPool,browserDeadline} from './browser';
import {validateSource} from './source';
import {sceneResources} from './resources';
import {verifiedBytes,serialized,temporaryStage,durableWrite,publishDirectory,sha256} from './files';
import {renderArguments} from './arguments';
import {runProcess,assertNotAborted} from './ffmpeg';
import {probeVideo} from './probe';
import {readVideoCache,videoManifest} from './cache';
export interface LocalContext {root:string;musicRoot:string;pool:BrowserPool;fonts:RuntimeFont[];version:RuntimeVersion;runtimeDigest:string;ffmpeg:string;ffprobe:string;frameFormat:'jpeg'|'png';frameTimeoutMs:number;timeoutMs:number}
export function validateRenderJob(job:MediaJob,digest:string){
 validateSource(job.sourceHtml);
 if(!z.uuid().safeParse(job.projectId).success||![job.operationId,job.attemptId].every(id=>z.uuid().safeParse(id).success)||!/^([a-f0-9]{64})$/.test(job.bundleHash)||job.runtimeDigest!==digest||job.stageKey!==computeStageKey(job)||[job.logicalWidth,job.logicalHeight,job.outputWidth,job.outputHeight].some(n=>!Number.isSafeInteger(n)||n<64||n>3840)||job.outputWidth%2||job.outputHeight%2||![24,30,60].includes(job.fps)||!Number.isSafeInteger(job.startFrame)||!Number.isSafeInteger(job.endFrame)||job.startFrame<0||job.endFrame<=job.startFrame||job.endFrame-job.startFrame>7200||!Number.isSafeInteger(job.seed)||!Number.isSafeInteger(job.fence)||job.fence<0)throw Error('RENDER_JOB_INVALID');
}
export async function renderShot(runtime:LocalContext,job:MediaJob,options:RenderOptions={}):Promise<RenderedVideo>{
 validateRenderJob(job,runtime.runtimeDigest);assertNotAborted(options.signal);
 const key=job.stageKey,parent=join(runtime.root,'media'),stage=join(parent,key),inputHash=canonicalHash({key,runtimeDigest:runtime.runtimeDigest});
 return serialized(stage,async()=>{
  assertNotAborted(options.signal);const cached=await readVideoCache(stage,key,runtime.runtimeDigest,inputHash);if(cached){if(options.onPoster&&cached.poster)await browserDeadline(async()=>{await options.onPoster!(await verifiedBytes(cached.poster!.path,cached.poster))},runtime.pool,runtime.frameTimeoutMs,options.signal);return cached;}
  const temp=await temporaryStage(parent,key),controller=new AbortController(),signal=options.signal?AbortSignal.any([options.signal,controller.signal]):controller.signal;
  let timedOut=false;const timer=setTimeout(()=>{timedOut=true;controller.abort()},runtime.timeoutMs);
  let context:Awaited<ReturnType<BrowserPool['context']>>|undefined,resources:Awaited<ReturnType<typeof sceneResources>>|undefined;
  try{
   const assets=new Map<string,{data:Buffer;mime:string}>();for(const asset of runtimeAssets(job.assets||[])){const path=join(runtime.root,'assets',job.projectId,asset.id+'.bin');assets.set(`/assets/${asset.id}.bin`,{data:await verifiedBytes(path,asset),mime:asset.mime})}
   resources=await sceneResources(job.sourceHtml,assets,runtime.fonts);context=await browserDeadline(async()=>{const created=await runtime.pool.context(job.logicalWidth,job.logicalHeight);if(signal.aborted){await runtime.pool.release(created);throw Error('MEDIA_ABORTED')}context=created;return created},runtime.pool,30000,signal,'RENDER_READY_TIMEOUT');
   let blocked=false,runtimeError:Error|undefined;const allowed=resources.allowed;
   await context.route('**/*',route=>{if(allowed.has(route.request().url())&&route.request().method()==='GET')return route.continue();blocked=true;return route.abort('blockedbyclient')});
   await context.routeWebSocket('**/*',ws=>{blocked=true;ws.close()});
   const page=await context.newPage();context.on('page',popup=>{if(popup!==page){blocked=true;void popup.close()}});page.on('download',download=>{blocked=true;void download.cancel()});page.on('pageerror',error=>{runtimeError=error});page.on('crash',()=>{runtimeError=Error('RENDER_PROCESS_CRASHED')});page.on('response',response=>{if(response.status()>=400)runtimeError=Error('RESOURCE_MISSING')});
   await browserDeadline(async()=>{await page.goto(resources!.origin+'/scene.html',{waitUntil:'load',timeout:30000});await page.waitForFunction(()=>Boolean((window as unknown as {READY:boolean}).READY===true),undefined,{timeout:30000});await page.evaluate(()=>document.fonts.ready)},runtime.pool,30000,signal,'RENDER_READY_TIMEOUT',context);
   const capture=await browserDeadline(()=>context!.newCDPSession(page),runtime.pool,runtime.frameTimeoutMs,signal,'RENDER_FRAME_TIMEOUT',context);
   const frame=async(index:number,png:boolean)=>browserDeadline(async()=>{
    const fastPng=await page.evaluate(async({time,png})=>{
     await (window as unknown as {render:(t:number)=>void|Promise<void>}).render(time);
     // Preserve Playwright's animation-finishing and caret-hiding semantics
     // whenever they are needed, including animations inside shadow roots.
     return png&&!document.getAnimations().length&&!document.querySelector('input,textarea,[contenteditable]')&&![...document.querySelectorAll('*')].some(element=>element.shadowRoot);
    },{time:index/job.fps,png:png||runtime.frameFormat==='png'});
    if(blocked)throw Error('RESOURCE_BLOCKED');if(runtimeError)throw Error(`SCENE_EXECUTION_FAILED: ${runtimeError.message.slice(0,160)}`);
    if(fastPng){const result=await capture.send('Page.captureScreenshot',{format:'png',optimizeForSpeed:true,captureBeyondViewport:false,fromSurface:true});return Buffer.from(result.data,'base64')}
    return page.screenshot({type:png?'png':runtime.frameFormat,quality:png||runtime.frameFormat==='png'?undefined:92,animations:'disabled',timeout:runtime.frameTimeoutMs});
   },runtime.pool,runtime.frameTimeoutMs,signal,'RENDER_FRAME_TIMEOUT',context).catch(error=>{if(blocked)throw Error('RESOURCE_BLOCKED');if(runtimeError?.message==='RENDER_PROCESS_CRASHED')throw runtimeError;throw error});
   const samples=[...new Set([job.startFrame,Math.floor((job.startFrame+job.endFrame)/2),job.endFrame-1])],baseline=new Map<number,Buffer>();
   for(const index of samples)baseline.set(index,await frame(index,true));for(const index of [...samples].reverse())if(!baseline.get(index)!.equals(await frame(index,true)))throw Error('NONDETERMINISTIC_SCENE');
   const poster=baseline.get(Math.floor((job.startFrame+job.endFrame)/2))!;await durableWrite(join(temp,'poster.png'),poster);
   if(options.onPoster)await browserDeadline(async()=>{await options.onPoster!(poster)},runtime.pool,runtime.frameTimeoutMs,signal,'RENDER_FRAME_TIMEOUT',context);
   const font=runtime.fonts.find(font=>font.id==='notosanssc');if(!font)throw Error('FONT_LOCK_INVALID: notosanssc label font is required');
   const partial=join(temp,'clip.mp4.partial');
   await runProcess(runtime.ffmpeg,renderArguments(job,font.path,partial,runtime.frameFormat),{signal,timeoutMs:runtime.timeoutMs,stdin:(async function*(){for(let index=job.startFrame;index<job.endFrame;index++)yield await frame(index,false)})()});
   const metadata=await probeVideo(partial,runtime.ffprobe,{signal,expected:{width:job.outputWidth,height:job.outputHeight,durationSec:(job.endFrame-job.startFrame)/job.fps,fps:job.fps,audio:false}});
   assertNotAborted(signal);await rename(partial,join(temp,'clip.mp4'));
   const result:RenderedVideo={...metadata,key,kind:'clip',poster:{path:join(stage,'poster.png'),sha256:sha256(poster),bytes:poster.length},runtimeDigest:runtime.runtimeDigest,outputPath:join(stage,'clip.mp4'),manifestPath:join(stage,'manifest.json')};
   await durableWrite(join(temp,'manifest.json'),JSON.stringify(videoManifest(key,runtime.version,result,inputHash)));assertNotAborted(signal);await publishDirectory(temp,stage);
   return (await readVideoCache(stage,key,runtime.runtimeDigest,inputHash))!;
  }catch(error){if(timedOut)throw Error('RENDER_TIMEOUT');if(options.signal?.aborted)throw Error('MEDIA_ABORTED');throw error}
  finally{clearTimeout(timer);if(context)await runtime.pool.release(context);await resources?.close();await rm(temp,{recursive:true,force:true})}
 });
}
export function requireRuntimePath(root:string,path:string){if(!resolve(path).startsWith(resolve(root)+'/'))throw Error('MEDIA_PATH_INVALID')}
