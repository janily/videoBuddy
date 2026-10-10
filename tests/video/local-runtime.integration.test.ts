import {afterEach,describe,expect,it,vi} from 'vitest';
import {randomUUID} from 'node:crypto';
import {mkdtemp,rm,readFile,writeFile,readdir,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:http';
import {createLocalRuntime} from '@/services/video/media/local';
import {computeStageKey,type MediaJob,type MediaRuntime} from '@/services/video/media/runtime';
import {sha256} from '@/services/video/media/local/files';
import {runProcess} from '@/services/video/media/local/ffmpeg';
import type {BrowserContext} from 'playwright';
import sharp from 'sharp';
import {BrowserPool,browserDeadline} from '@/services/video/media/local/browser';
const roots:string[]=[],runtimes:MediaRuntime[]=[];
const scene=(body="ctx.fillStyle='#163743';ctx.fillRect(0,0,320,180);ctx.fillStyle='#b4dcdc';ctx.fillRect(t*24,70,40,40)")=>`<!doctype html><canvas id="scene" width="320" height="180"></canvas><script>const ctx=document.querySelector('canvas').getContext('2d');window.render=t=>{${body}};window.READY=true;</script>`;
async function fixture(frameFormat:'png'|'jpeg'='png',concurrency=1,frameTimeoutMs=700){const root=await mkdtemp(join(tmpdir(),'vb-local-native-'));roots.push(root);const runtime=await createLocalRuntime({root,fontsDir:process.env.VIDEO_TEST_FONTS_DIR,env:{NODE_ENV:'development',VIDEO_UNSAFE_NO_SANDBOX:'1',VIDEO_CHROMIUM_EXECUTABLE_PATH:process.env.VIDEO_TEST_CHROMIUM},frameTimeoutMs,timeoutMs:30000,concurrency,frameFormat});runtimes.push(runtime);return{root,runtime}}
function job(runtime:MediaRuntime,sourceHtml=scene()):MediaJob{const input={projectId:randomUUID(),operationId:randomUUID(),attemptId:randomUUID(),bundleHash:'a'.repeat(64),runtimeDigest:runtime.runtimeDigest,sourceHtml,logicalWidth:320,logicalHeight:180,outputWidth:320,outputHeight:180,fps:24 as const,startFrame:0,endFrame:12,seed:1,fence:0};return{...input,stageKey:computeStageKey(input)}}
afterEach(async()=>{await Promise.all(runtimes.splice(0).map(runtime=>runtime.close()));await Promise.all(roots.splice(0).map(root=>rm(root,{recursive:true,force:true})))});

describe('browser cancellation ownership',()=>{
 it('closes only the owning context on ordinary abort',async()=>{
  const pool=new BrowserPool(),reset=vi.spyOn(pool,'reset').mockResolvedValue(),release=vi.spyOn(pool,'release').mockResolvedValue(),owner={} as BrowserContext,abort=new AbortController();
  const running=browserDeadline(()=>new Promise<void>(()=>{}),pool,10000,abort.signal,'RENDER_FRAME_TIMEOUT',owner);
  const rejected=expect(running).rejects.toThrow('MEDIA_ABORTED');abort.abort();await rejected;
  expect(release).toHaveBeenCalledExactlyOnceWith(owner);expect(reset).not.toHaveBeenCalled();
 });
 it('deduplicates context cleanup and only resets the pool if closing stalls',async()=>{
  vi.useFakeTimers();
  try{
   const pool=new BrowserPool(),reset=vi.spyOn(pool,'reset').mockResolvedValue(),close=vi.fn(()=>new Promise<void>(()=>{})),owner={close} as unknown as BrowserContext;
   const first=pool.release(owner),second=pool.release(owner);expect(first).toBe(second);
   await vi.advanceTimersByTimeAsync(499);expect(reset).not.toHaveBeenCalled();
   await vi.advanceTimersByTimeAsync(1);await first;expect(reset).toHaveBeenCalledTimes(1);expect(close).toHaveBeenCalledTimes(1);
  }finally{vi.useRealTimers()}
 });
 it('does not reset a shared pool when aborted before an owning context exists',async()=>{
  const pool=new BrowserPool(),reset=vi.spyOn(pool,'reset').mockResolvedValue(),release=vi.spyOn(pool,'release').mockResolvedValue(),abort=new AbortController();
  const running=browserDeadline(()=>new Promise<void>(()=>{}),pool,10000,abort.signal);
  const rejected=expect(running).rejects.toThrow('MEDIA_ABORTED');abort.abort();await rejected;
  expect(release).not.toHaveBeenCalled();expect(reset).not.toHaveBeenCalled();
 });
});

// Explicit opt-in: these are real Chromium/ffmpeg executions. Development
// override results are never presented as production sandbox evidence.
describe.runIf(Boolean(process.env.VIDEO_TEST_CHROMIUM))('local native runtime',()=>{
 it.each(['png','jpeg'] as const)('renders %s, preserves the trusted label, stream-copies assembly, and verifies cached hashes',async format=>{
  const {runtime,root}=await fixture(format),input=job(runtime,scene("document.body.style.background='black';ctx.fillStyle='black';ctx.fillRect(0,0,320,180)"));let poster:Buffer|undefined;
  const clip=await runtime.renderShot(input,{onPoster:buffer=>{poster=buffer}});expect(poster?.subarray(0,8).toString('hex')).toBe('89504e470d0a1a0a');expect(clip).toMatchObject({frameCount:12,width:320,height:180,kind:'clip',audio:false,videoCodec:'h264'});
  const pixels=join(root,'frame.rgb');await runProcess('ffmpeg',['-v','error','-i',clip.outputPath,'-frames:v','1','-f','rawvideo','-pix_fmt','rgb24',pixels]);const rgb=await readFile(pixels);
  expect(rgb.reduce((max,value)=>Math.max(max,value),0)).toBeGreaterThan(100); // Scene is pure black; only trusted label adds bright pixels.
  const final=await runtime.assemble({projectId:input.projectId,clips:[clip,clip],music:null,title:'Native fixture'});expect(final).toMatchObject({kind:'final',frameCount:24,audio:true,audioChannels:2,sampleRate:48000,audioCodec:'aac'});expect(final.tags.aigc).toContain('VideoBuddy');
  let cachedPoster:Buffer|undefined;expect(await runtime.renderShot(input,{onPoster:buffer=>{cachedPoster=buffer}})).toEqual(clip);expect(cachedPoster).toEqual(poster);expect(await runtime.assemble({projectId:input.projectId,clips:[clip,clip],music:null,title:'Native fixture'})).toEqual(final);
  await expect(runtime.probe('/etc/passwd')).rejects.toThrow('MEDIA_PATH_INVALID');
  const musicDir=join(root,'media','music');await mkdir(musicDir);const musicPath=join(musicDir,'tone.wav');await runProcess('ffmpeg',['-v','error','-f','lavfi','-i','sine=frequency=440:duration=1','-ar','48000','-ac','2',musicPath]);const musicBytes=await readFile(musicPath);
  const remixed=await runtime.assemble({projectId:input.projectId,clips:[clip,clip],music:{path:musicPath,trackId:'fixture',sha256:sha256(musicBytes),bytes:musicBytes.length},title:'Native fixture'});
  const elementary=[] as Buffer[];for(const [index,result] of [final,remixed].entries()){const path=join(root,`video-${index}.h264`);await runProcess('ffmpeg',['-v','error','-i',result.outputPath,'-map','0:v:0','-c:v','copy','-f','h264',path]);elementary.push(await readFile(path))}expect(elementary[0]).toEqual(elementary[1]);
  const bytes=await readFile(clip.outputPath);await writeFile(clip.outputPath,Buffer.concat([bytes,Buffer.from('tamper')]));await expect(runtime.renderShot(input)).rejects.toThrow('MEDIA_HASH_MISMATCH');
 },30000);
 it('captures lossless fast PNG pixels matching the original screenshot path',async()=>{
  const original=BrowserPool.prototype.context,references:Buffer[]=[],captures:unknown[]=[];
  const spy=vi.spyOn(BrowserPool.prototype,'context').mockImplementation(async function(this:BrowserPool,...args){
   const context=await original.apply(this,args),open=context.newCDPSession.bind(context);
   vi.spyOn(context,'newCDPSession').mockImplementation(async page=>{
    const session=await open(page),send=session.send.bind(session);
    vi.spyOn(session,'send').mockImplementation(async(method,params)=>{
     if(method==='Page.captureScreenshot'){captures.push(params);references.push(await (page as import('playwright').Page).screenshot({type:'png',animations:'disabled'}))}
     return send(method,params);
    });return session;
   });return context;
  });
  try{
   const {runtime}=await fixture('png',1,5000);let poster:Buffer|undefined;
   await runtime.renderShot(job(runtime),{onPoster:bytes=>{poster=bytes}});
   expect(captures).toHaveLength(18);expect(captures[0]).toEqual({format:'png',optimizeForSpeed:true,captureBeyondViewport:false,fromSurface:true});
   expect(await sharp(poster!).raw().toBuffer()).toEqual(await sharp(references[1]).raw().toBuffer());
  }finally{spy.mockRestore()}
 },15000);
 it('retains Playwright animation disabling for animated PNG scenes',async()=>{
  const original=BrowserPool.prototype.context,captures:unknown[]=[];
  const spy=vi.spyOn(BrowserPool.prototype,'context').mockImplementation(async function(this:BrowserPool,...args){
   const context=await original.apply(this,args),open=context.newCDPSession.bind(context);
   vi.spyOn(context,'newCDPSession').mockImplementation(async page=>{const session=await open(page),send=session.send.bind(session);vi.spyOn(session,'send').mockImplementation(async(method,params)=>{if(method==='Page.captureScreenshot')captures.push(params);return send(method,params)});return session});return context;
  });
  try{
   const {runtime}=await fixture('png',1,5000),source=scene()+`<style>@keyframes fade{from{opacity:0}to{opacity:1}}canvas{animation:fade 2s infinite}</style>`;
   expect((await runtime.renderShot(job(runtime,source))).frameCount).toBe(12);expect(captures).toEqual([]);
  }finally{spy.mockRestore()}
 },15000);
 it('reuses one browser while isolating cookies and disabling WebRTC in each context',async()=>{
  const pool=new BrowserPool({NODE_ENV:'development',VIDEO_UNSAFE_NO_SANDBOX:'1',VIDEO_CHROMIUM_EXECUTABLE_PATH:process.env.VIDEO_TEST_CHROMIUM});
  try{const browser=await pool.get(),first=await pool.context(),second=await pool.context();expect(await pool.get()).toBe(browser);
   await first.addCookies([{name:'private',value:'first',url:'http://scene.test'}]);expect(await second.cookies()).toEqual([]);
   const page=await second.newPage();expect(await page.evaluate(()=>typeof window.RTCPeerConnection)).toBe('undefined');
   await pool.release(first);expect(await pool.get()).toBe(browser);await pool.release(second);
  }finally{await pool.close()}
 },15000);
 it('rejects nondeterministic scenes before publishing a clip',async()=>{
  const {runtime,root}=await fixture();await expect(runtime.renderShot(job(runtime,scene("ctx.fillStyle='rgb('+Math.floor(Math.random()*255)+',0,0)';ctx.fillRect(0,0,320,180)")))).rejects.toThrow('NONDETERMINISTIC_SCENE');expect((await readdir(join(root,'media'))).length).toBe(0);
 },15000);
 it('kills a hung renderer, then starts a healthy browser for the next job',async()=>{
  const {runtime}=await fixture();await expect(runtime.renderShot(job(runtime,scene('while(true){}')))).rejects.toThrow('RENDER_FRAME_TIMEOUT');expect((await runtime.renderShot(job(runtime))).frameCount).toBe(12);
 },15000);
 it('aborts within two seconds without publishing partial media',async()=>{
  const {runtime,root}=await fixture(),abort=new AbortController();let cancelledAt=0;
  await expect(runtime.renderShot(job(runtime),{signal:abort.signal,onPoster:()=>{cancelledAt=Date.now();abort.abort()}})).rejects.toThrow('MEDIA_ABORTED');expect(Date.now()-cancelledAt).toBeLessThan(2000);expect(await readdir(join(root,'media'))).toEqual([]);
 },15000);
 it('closes a context that arrives after its render was cancelled without resetting the pool',async()=>{
  const {runtime}=await fixture('png',2,5000),abort=new AbortController(),original=BrowserPool.prototype.context;
  let created!:()=>void,releaseCreation!:()=>void,lateContext:BrowserContext|undefined;
  const reached=new Promise<void>(resolve=>{created=resolve}),hold=new Promise<void>(resolve=>{releaseCreation=resolve});
  const contextSpy=vi.spyOn(BrowserPool.prototype,'context').mockImplementationOnce(async function(this:BrowserPool,...args){lateContext=await original.apply(this,args);created();await hold;return lateContext});
  const reset=vi.spyOn(BrowserPool.prototype,'reset');
  const first=runtime.renderShot(job(runtime),{signal:abort.signal}).catch(error=>error as Error);
  try{
   await reached;const close=vi.spyOn(lateContext!,'close');abort.abort();expect(await first).toMatchObject({message:'MEDIA_ABORTED'});
   releaseCreation();await expect.poll(()=>close.mock.calls.length).toBe(1);expect(reset).not.toHaveBeenCalled();
   expect((await runtime.renderShot(job(runtime))).frameCount).toBe(12);
  }finally{releaseCreation();await first;contextSpy.mockRestore();reset.mockRestore()}
 },15000);
 it('cancels one of two concurrent renders without closing the other context',async()=>{
  const {runtime,root}=await fixture('png',2,5000),abort=new AbortController();
  let firstReady!:()=>void,secondReady!:()=>void,releaseFirst!:()=>void,releaseSecond!:()=>void;
  const firstReached=new Promise<void>(resolve=>{firstReady=resolve}),secondReached=new Promise<void>(resolve=>{secondReady=resolve});
  const firstHold=new Promise<void>(resolve=>{releaseFirst=resolve}),secondHold=new Promise<void>(resolve=>{releaseSecond=resolve});
  const firstInput=job(runtime),secondInput=job(runtime),first=runtime.renderShot(firstInput,{signal:abort.signal,onPoster:async()=>{firstReady();await firstHold}}).catch(error=>error as Error);
  await firstReached;
  const second=runtime.renderShot(secondInput,{onPoster:async()=>{secondReady();await secondHold}});void second.catch(()=>{});
  try{
   await secondReached;const cancelledAt=Date.now();abort.abort();expect(await first).toMatchObject({message:'MEDIA_ABORTED'});expect(Date.now()-cancelledAt).toBeLessThan(2000);
   releaseSecond();expect(await second).toMatchObject({frameCount:12,kind:'clip'});
   expect((await readdir(join(root,'media'))).sort()).toEqual([secondInput.stageKey]);
  }finally{releaseFirst();releaseSecond();await Promise.allSettled([first,second])}
 },15000);
 it('blocks obfuscated external requests through CSP and resource routing',async()=>{
  const {runtime}=await fixture();let requests=0;const server=createServer((_req,res)=>{requests++;res.end('blocked')});await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address();if(!address||typeof address==='string')throw Error('fixture');
  try{const attack=`const url=['http:','','127.0.0.1:${address.port}','steal'].join('/');(window['fet'+'ch'])(url).catch(()=>{});const image=new Image();image.src=url;try{new (window['Web'+'Socket'])(url.replace('http:','ws:'))}catch{};ctx.fillStyle='black';ctx.fillRect(0,0,320,180)`;
   await runtime.renderShot(job(runtime,scene(attack))).catch(error=>{expect(error.message).toMatch(/RESOURCE_BLOCKED|SCENE_EXECUTION_FAILED/)});expect(requests).toBe(0);
  }finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()))}
 },15000);
 it('blocks an external top-level navigation without contacting its server',async()=>{
  const {runtime}=await fixture();let requests=0;const server=createServer((_req,res)=>{requests++;res.end('blocked')});await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address();if(!address||typeof address==='string')throw Error('fixture');
  try{await expect(runtime.renderShot(job(runtime,scene(`location.href=['http:','','127.0.0.1:${address.port}','steal'].join('/')`)))).rejects.toThrow('RESOURCE_BLOCKED');expect(requests).toBe(0)}finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()))}
 },15000);
 it('contains a heap-allocation bomb and remains available for the next task',async()=>{
  const {runtime}=await fixture();await expect(runtime.renderShot(job(runtime,scene("const heap=[];while(true){heap.push(new Array(100000).fill('heap'))}")))).rejects.toThrow(/RENDER_FRAME_TIMEOUT|RENDER_PROCESS_CRASHED/);expect((await runtime.renderShot(job(runtime))).frameCount).toBe(12);
 },15000);
 it('normalizes owned images and rejects mismatched hashes and arbitrary paths',async()=>{
  const {runtime,root}=await fixture(),projectId=randomUUID(),assetId=randomUUID(),path=join(root,'assets',projectId,assetId+'.bin');await mkdir(join(root,'assets',projectId),{recursive:true});
  // A real raster generated by trusted ffmpeg; source image never becomes HTML.
  await runProcess('ffmpeg',['-v','error','-f','lavfi','-i','color=blue:size=3000x1000','-frames:v','1','-f','image2','-c:v','png',path]);const bytes=await readFile(path),input={projectId,assetId,sourcePath:path,sourceMime:'image/png' as const,sourceSha256:sha256(bytes),sourceBytes:bytes.length};
  const image=await runtime.prepareImage(input);expect(image).toMatchObject({width:2048,height:683,encodedWidth:3000,encodedHeight:1000,mime:'image/png'});expect(await runtime.prepareImage(input)).toEqual(image);
  await expect(runtime.prepareImage({...input,sourceSha256:'a'.repeat(64)})).rejects.toThrow('MEDIA_HASH_MISMATCH');await expect(runtime.prepareImage({...input,sourcePath:'/etc/passwd'})).rejects.toThrow('IMAGE_INPUT_INVALID');
 },15000);
});
