// Read-only, credential-free diagnostic. Original generated HTML is untouched.
import {chromium} from 'playwright';
import {readFile,writeFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {createHash} from 'node:crypto';
const job=JSON.parse(await readFile('/input/job.json','utf8'));
const mode=process.argv[2];if(!['default','software','readback','reset'].includes(mode))throw Error('DIAGNOSTIC_MODE_INVALID');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex'),html=await readFile('/input/scene.html');
const server=createServer((req,res)=>{if(req.url!=='/scene.html'){res.writeHead(404);res.end();return}res.setHeader('Content-Type','text/html');res.end(html)});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin=`http://127.0.0.1:${server.address().port}`;
let browser;
try{
 browser=await chromium.launch({headless:true,executablePath:'/usr/bin/chromium',args:['--no-sandbox','--disable-dev-shm-usage',...(mode==='software'?['--disable-accelerated-2d-canvas','--disable-gpu']:[])]});
 const context=await browser.newContext({viewport:{width:job.logicalWidth,height:job.logicalHeight},deviceScaleFactor:1,serviceWorkers:'block'});
 await context.route('**/*',route=>route.request().url()===origin+'/scene.html'?route.continue():route.abort());
 if(mode==='readback')await context.addInitScript(()=>{const original=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(type,options){return original.call(this,type,type==='2d'?{...options,willReadFrequently:true}:options)}});
 const page=await context.newPage();let runtimeError;page.on('pageerror',error=>runtimeError=error);await page.goto(origin+'/scene.html',{waitUntil:'load'});await page.waitForFunction(()=>window.READY===true,{},{timeout:30000});await page.evaluate(()=>document.fonts.ready);
 const samples=[...new Set([job.startFrame,Math.floor((job.startFrame+job.endFrame)/2),job.endFrame-1])],frames=[];
 for(const [round,order] of [samples,samples.toReversed(),samples].entries())for(const frame of order){
  await page.evaluate(({t,reset})=>{if(reset)for(const canvas of document.querySelectorAll('canvas'))canvas.getContext('2d').reset();window.render(t)},{t:frame/job.fps,reset:mode==='reset'});if(runtimeError)throw runtimeError;
  const png=await page.screenshot({animations:'disabled'}),name=`round-${round}-frame-${frame}.png`;await writeFile('/output/'+name,png);
  const canvas=await page.evaluate(()=>Array.from(document.querySelectorAll('canvas')).map(canvas=>{const c=canvas.getContext('2d');return{image:canvas.toDataURL(),state:{font:c.font,globalAlpha:c.globalAlpha,composite:c.globalCompositeOperation,filter:c.filter,transform:Array.from(c.getTransform().toFloat64Array())}}}));
  frames.push({round,frame,file:name,pngSha256:sha(png),canvases:canvas.map(c=>({sha256:sha(Buffer.from(c.image)),state:c.state}))});
 }
 const differences=frames.filter(entry=>entry.round>0&&entry.pngSha256!==frames.find(original=>original.round===0&&original.frame===entry.frame).pngSha256);
 const result={schemaVersion:1,mode,sceneSha256:sha(html),status:differences.length?'non_deterministic':'deterministic',frames,differingFrames:differences.map(({round,frame})=>({round,frame}))};await writeFile('/output/report.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve))}
