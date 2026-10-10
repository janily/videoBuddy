// Trusted renderer baked into a pinned image. Never run generated scenes on the web host.
import { chromium } from 'playwright';
import { readFile, mkdir, writeFile, rename } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import {createRuntimeAssetServer,verifyRuntimeAssetInputs} from './runtime-assets.mjs';
import { spawn } from 'node:child_process';
const jobFile=process.argv[2];if(!/^\/work\/[a-f0-9]{64}\/job\.json$/.test(jobFile))throw Error('INVALID_JOB');
const root=dirname(jobFile),job=JSON.parse(await readFile(jobFile,'utf8'));
if(!Number.isSafeInteger(job.endFrame)||job.endFrame-job.startFrame>7200)throw Error('FRAME_LIMIT');
await verifyRuntimeAssetInputs(root,job.assets||[]);
const server=createRuntimeAssetServer(root,job.assets||[]);
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin=`http://127.0.0.1:${server.address().port}`;
let browser;
try{
 const launch=()=>chromium.launch({headless:true,executablePath:'/usr/bin/chromium',args:['--no-sandbox','--disable-dev-shm-usage']});
 // Decode in a separate browser before generated scene code executes. Closing
 // that browser avoids cross-context protocol events during scene rendering.
 if(job.assets?.length){
  browser=await launch();
  const decoder=await browser.newContext({serviceWorkers:'block'});
  await decoder.route('**/*',route=>route.request().url().startsWith(origin+'/')?route.continue():route.abort());
  const decoderPage=await decoder.newPage();
  const decoded=await decoderPage.evaluate(async({origin,assets})=>{try{for(const asset of assets){const image=new Image();image.src=origin+'/assets/'+asset.id+'.bin';await image.decode();if(!image.naturalWidth||!image.naturalHeight)return false}return true}catch{return false}},{origin,assets:job.assets});
  if(decoded!==true)throw Error('IMAGE_DECODE_FAILED');
  await browser.close();browser=null;
 }
 browser=await launch();const context=await browser.newContext({viewport:{width:job.logicalWidth,height:job.logicalHeight},deviceScaleFactor:1,serviceWorkers:'block'});
 await context.route('**/*',route=>route.request().url().startsWith(origin+'/')?route.continue():route.abort());
 const page=await context.newPage();let runtimeError;page.on('pageerror',e=>runtimeError=e);page.on('response',r=>{if(r.status()>=400)runtimeError=Error('RESOURCE_MISSING')});
 await page.goto(origin+'/scene.html',{waitUntil:'load'});await page.waitForFunction(()=>window.READY===true,{},{timeout:30000});await page.evaluate(()=>document.fonts.ready);
 const output=join(root,'output'),frames=join(root,'frames');await mkdir(output,{recursive:true});await mkdir(frames,{recursive:true});
 const samples=[...new Set([job.startFrame,Math.floor((job.startFrame+job.endFrame)/2),job.endFrame-1])],baseline=new Map();
 for(const frame of samples){await page.evaluate(t=>window.render(t),frame/job.fps);if(runtimeError)throw runtimeError;baseline.set(frame,await page.screenshot({animations:'disabled'}))}
 for(const frame of samples.toReversed()){await page.evaluate(t=>window.render(t),frame/job.fps);if(runtimeError)throw runtimeError;if(!baseline.get(frame).equals(await page.screenshot({animations:'disabled'})))throw Error('NONDETERMINISTIC_SCENE')}
 // Publish the verified middle frame before full rendering; the host can show it immediately.
 await writeFile(join(output,'poster.pending'),baseline.get(Math.floor((job.startFrame+job.endFrame)/2)));
 await rename(join(output,'poster.pending'),join(output,'poster.png'));
 for(let f=job.startFrame;f<job.endFrame;f++){await page.evaluate(t=>window.render(t),f/job.fps);if(runtimeError)throw runtimeError;await page.screenshot({path:join(frames,`${String(f-job.startFrame).padStart(6,'0')}.png`),animations:'disabled'})}
 await browser.close();browser=null;
 await new Promise((resolve,reject)=>{const ff=spawn('ffmpeg',['-v','error','-threads','2','-filter_threads','2','-framerate',String(job.fps),'-i',join(frames,'%06d.png'),'-vf',`scale=${job.outputWidth}:${job.outputHeight}:flags=lanczos`,'-c:v','libx264','-threads','2','-pix_fmt','yuv420p','-color_primaries','bt709','-color_trc','bt709','-colorspace','bt709','-movflags','+faststart','-y',join(output,'picture.mp4')],{stdio:'inherit'});ff.on('error',reject);ff.on('exit',code=>code===0?resolve():reject(Error('ENCODE_FAILED')))});
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve))}
