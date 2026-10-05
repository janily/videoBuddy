import {execFileSync} from 'node:child_process';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium} from '/opt/videobuddy/node_modules/playwright/index.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex');
const job=JSON.parse(await readFile('/work/job.json','utf8')),source=await readFile('/work/book-caption.mjs');
if(sha(source)!==job.rendererSha256||job.fonts.length!==2)throw Error('GLYPH_PROBE_SOURCE_CHANGED');
const fonts=[];for(const item of job.fonts){const bytes=await readFile(item.path);if(sha(bytes)!==item.sha256)throw Error('GLYPH_PROBE_FONT_CHANGED');fonts.push({family:item.family,data:bytes.toString('base64')})}
const family=job.fonts[0].family;
const inspected=execFileSync('fc-query',['-i','0','-f','%{family}\n%{charset}',job.fonts[0].path],{timeout:8000,maxBuffer:200000}).toString('utf8');
const [actualFamily,charset]=inspected.split('\n');if(!actualFamily.split(',').includes(family))throw Error('GLYPH_PROBE_FAMILY_CHANGED');
const ranges=charset.trim().split(/\s+/).map(r=>r.split('-').map(x=>parseInt(x,16)));
const required='洒下适量的水润湿土壤把小种子轻轻放进泥土里探出了嫩绿的小芽观察成长耐心照料科米禾';
const missing=[...new Set(required)].filter(c=>!ranges.some(([a,b=a])=>c.codePointAt(0)>=a&&c.codePointAt(0)<=b));
if(missing.length)throw Error('GLYPH_PROBE_MISSING: '+missing.join(''));
let browser;
try{
 browser=await chromium.launch({headless:true,executablePath:'/usr/bin/chromium',args:['--no-sandbox','--disable-dev-shm-usage']});
 const context=await browser.newContext({viewport:{width:1280,height:1000},serviceWorkers:'block'});await context.route('**/*',r=>r.abort());
 const page=await context.newPage();await page.setContent('<canvas width="1280" height="1000"></canvas>');
 await page.evaluate(async({source,fonts})=>{window.caption=await import('data:text/javascript;base64,'+source);for(const font of fonts){const face=new FontFace(font.family,'url(data:font/ttf;base64,'+font.data+')');document.fonts.add(await face.load())}await document.fonts.ready},{source:source.toString('base64'),fonts});
 const rendered=await page.evaluate(family=>{
  const canvas=document.querySelector('canvas'),ctx=canvas.getContext('2d');ctx.fillStyle='#f7f1e7';ctx.fillRect(0,0,1280,1000);ctx.fillStyle='#563c2e';
  const samples=[],masks={};
  for(const [row,size] of [104,52,52*2/3].entries()){
   const y=80+row*210;ctx.font='20px sans-serif';ctx.fillText(family+', '+size.toFixed(2)+'px; U+6599 / U+79D1 / U+7C73 / U+79BE',40,y);
   ctx.font=`${size}px "${family}"`;ctx.textAlign='left';ctx.textBaseline='top';
   for(const [i,ch] of [...'料科米禾'].entries()){
    ctx.fillText(ch,100+i*240,y+40);const off=document.createElement('canvas');off.width=160;off.height=160;const o=off.getContext('2d');o.font=`${size}px "${family}"`;o.textBaseline='top';o.fillText(ch,10,10);const data=o.getImageData(0,0,160,160).data;const alpha=[];for(let k=3;k<data.length;k+=4)alpha.push(data[k]);masks[size+':'+ch]=alpha;
    samples.push({character:ch,codepoint:'U+'+ch.codePointAt(0).toString(16).toUpperCase(),fontSize:size,advance:ctx.measureText(ch).width,alpha});
   }
  }
  ctx.textAlign='center';ctx.textBaseline='middle';
  for(const [i,text] of ['观察成长，耐心照料。','观察成长，耐心照科。'].entries()){
   const layout=window.caption.layoutBookCaption(text,{safeBox:{x:40,y:700+i*145,width:1200,height:130},measure:(t,f,s)=>{ctx.font=`${s}px "${family}"`;return ctx.measureText(t).width}});
   for(const glyph of layout.glyphs)glyph.family=family;
   window.caption.drawBookCaption(ctx,layout,{id:'same-comparison',startMs:0,endMs:5000},2000);
  }
  const comparisons=[104,52,52*2/3].map(size=>{const a=masks[size+':料'],b=masks[size+':科'];let delta=0,intersection=0,union=0;for(let k=0;k<a.length;k++){delta+=Math.abs(a[k]-b[k]);if(a[k]||b[k])union++;if(a[k]&&b[k])intersection++}return{fontSize:size,absoluteAlphaDifference:delta,maskIntersectionOverUnion:intersection/union}});
  return{png:canvas.toDataURL('image/png').split(',')[1],samples,comparisons};
 },family);
 await mkdir('/output',{recursive:true});const png=Buffer.from(rendered.png,'base64');await writeFile('/output/glyph-comparison.png',png);
 const samples=rendered.samples.map(({alpha,...s})=>({...s,alphaSha256:sha(Buffer.from(alpha))}));
 const report={schemaVersion:1,selectedFamily:family,captionFamilyOverrideForDiagnosticOnly:family!=='Ma Shan Zheng',requiredCharacters:required,missing,actualFamily,charsetSha256:sha(Buffer.from(charset)),rendererSha256:job.rendererSha256,fontSha256s:job.fonts.map(f=>f.sha256),image:{filename:'glyph-comparison.png',sha256:sha(png),bytes:png.length},samples,comparisons:rendered.comparisons};
 await writeFile('/output/result.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
}finally{await browser?.close()}
