import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium} from '/opt/videobuddy/node_modules/playwright/index.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex');
const job=JSON.parse(await readFile('/work/job.json','utf8')),source=await readFile('/work/book-caption.mjs');
if(sha(source)!==job.rendererSha256||job.fonts.length!==2)throw Error('CAPTION_PROBE_SOURCE_CHANGED');
const fonts=[];
for(const item of job.fonts){const bytes=await readFile(item.path);if(sha(bytes)!==item.sha256)throw Error('CAPTION_PROBE_FONT_CHANGED');fonts.push({family:item.family,data:bytes.toString('base64'),sha256:sha(bytes)})}
let browser;
try{
 browser=await chromium.launch({headless:true,executablePath:'/usr/bin/chromium',args:['--no-sandbox','--disable-dev-shm-usage']});
 const context=await browser.newContext({viewport:{width:1920,height:1080},serviceWorkers:'block'});await context.route('**/*',r=>r.abort());
 const page=await context.newPage();await page.setContent('<canvas width="1920" height="1080"></canvas>');
 await page.evaluate(async({source,fonts})=>{
  window.caption=await import('data:text/javascript;base64,'+source);
  for(const font of fonts){const face=new FontFace(font.family,'url(data:font/ttf;base64,'+font.data+')');document.fonts.add(await face.load())}
  await document.fonts.ready;
 },{source:source.toString('base64'),fonts});
 const boundaries=await page.evaluate(()=>{
  const ctx=document.querySelector('canvas').getContext('2d'),measure=(text,family,size)=>{ctx.font=`${size}px "${family}"`;return ctx.measureText(text).width};
  const rejected=[];for(const [text,height] of [['观察成长',120],['观察\n成长',192]]){let error;try{window.caption.layoutBookCaption(text,{safeBox:{x:100,y:800,width:400,height},measure})}catch(e){error=e.message}if(error!=='BOOK_CAPTION_OVERFLOW')throw Error('CAPTION_BOUNDARY_ACCEPTED');rejected.push({text,height,error})}
  const layout=window.caption.layoutBookCaption('观察',{safeBox:{x:100,y:800,width:160,height:126},measure});
  const b=layout.bounds;if(b.x<103||b.y<803||b.x+b.width>257||b.y+b.height>923)throw Error('CAPTION_BOUNDARY_MARGIN_INVALID');
  return{rejected,accepted:layout};
 });
 const cases=[];await mkdir('/output',{recursive:true});
 for(const sample of [{id:'chinese',text:'洒下适量的水，润湿土壤。'},{id:'english',text:'Observe growth, care with patience.'}]){
  const times=[999,1000,1175,1350,2000,2040,2084,6000],baseline=new Map(),results=[];
  const render=async time=>page.evaluate(({sample,time})=>{
   const canvas=document.querySelector('canvas'),ctx=canvas.getContext('2d');ctx.reset();
   const safeBox={x:100,y:800,width:1720,height:200};
   const layout=window.caption.layoutBookCaption(sample.text,{safeBox,measure:(text,family,size)=>{ctx.font=`${size}px "${family}"`;return ctx.measureText(text).width}});
   const state=window.caption.drawBookCaption(ctx,layout,{id:sample.id,startMs:1000,endMs:6000},time);
   const image=ctx.getImageData(0,0,canvas.width,canvas.height);let x0=canvas.width,y0=canvas.height,x1=-1,y1=-1;
   for(let y=0;y<canvas.height;y++)for(let x=0;x<canvas.width;x++)if(image.data[(y*canvas.width+x)*4+3]){x0=Math.min(x0,x);y0=Math.min(y0,y);x1=Math.max(x1,x);y1=Math.max(y1,y)}
   const bbox=x1<0?null:[x0,y0,x1+1,y1+1];if(bbox&&(bbox[0]<safeBox.x||bbox[1]<safeBox.y||bbox[2]>safeBox.x+safeBox.width||bbox[3]>safeBox.y+safeBox.height))throw Error('CAPTION_SAFE_BOX_OVERFLOW');
   return{png:canvas.toDataURL('image/png').split(',')[1],bbox,visibleGlyphs:state.glyphs.length,stableReadableStartMs:state.stableReadableStartMs,layout};
  },{sample,time});
  for(const time of times){const result=await render(time),png=Buffer.from(result.png,'base64');baseline.set(time,sha(png));const name=sample.id+'-'+time+'.png';await writeFile('/output/'+name,png);const {png:_,...metadata}=result;results.push({timeMs:time,pngName:name,pngSha256:sha(png),pngBytes:png.length,...metadata})}
  for(const time of times.toReversed()){const result=await render(time);if(sha(Buffer.from(result.png,'base64'))!==baseline.get(time))throw Error('CAPTION_NONDETERMINISTIC')}
  if(baseline.get(2000)!==baseline.get(2040)||baseline.get(2040)===baseline.get(2084))throw Error('CAPTION_BOIL_RATE_INVALID');
  cases.push({id:sample.id,text:sample.text,reverseOrderIdentical:true,results});
 }
 const report={schemaVersion:1,rendererSha256:job.rendererSha256,fontSha256s:fonts.map(f=>f.sha256),boundaries,cases};await writeFile('/output/result.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
}catch(error){const failure={status:'failed',errorCode:String(error.message).split('\n')[0].slice(0,300)};await mkdir('/output',{recursive:true});await writeFile('/output/failure.json',JSON.stringify(failure));console.log(JSON.stringify(failure))}finally{await browser?.close()}
