// Trusted alpha-layer producer, mounted read-only and bound by its byte hash.
import {readFile,writeFile,rename,open,stat,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const exec=promisify(execFile);
import {chromium} from '/opt/videobuddy/node_modules/playwright/index.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex'),key=process.argv[2];
if(!/^[a-f0-9]{64}$/.test(key))throw Error('BOOK_CAPTION_JOB_INVALID');
const raw=await readFile('/work/job.json'),job=JSON.parse(raw),source=await readFile('/work/renderer.mjs');
if(sha(raw)!==key||sha(source)!==job.rendererSha256||sha(await readFile('/work/producer.mjs'))!==job.producerSha256||job.frames>7200||job.frames<480||job.fonts.length!==2)throw Error('BOOK_CAPTION_SOURCE_CHANGED');
const fonts=[];for(const font of job.fonts){const bytes=await readFile(font.path);if(sha(bytes)!==font.sha256)throw Error('BOOK_CAPTION_FONT_CHANGED');fonts.push({family:font.family,data:bytes.toString('base64')})}
let browser,encoder;
async function command(args){const task=spawn('ffmpeg',args,{stdio:['ignore','ignore','pipe']}),errors=[];task.stderr.on('data',b=>{if(Buffer.concat(errors).length<2048)errors.push(b)});const code=await new Promise((resolve,reject)=>{task.once('error',reject);task.once('close',resolve)});if(code!==0)throw Error('BOOK_CAPTION_DECODE_FAILED: '+Buffer.concat(errors).toString().slice(0,200))}
try{
 await mkdir('/output',{recursive:true});
 browser=await chromium.launch({headless:true,executablePath:'/usr/bin/chromium',args:['--no-sandbox','--disable-dev-shm-usage']});
 const context=await browser.newContext({viewport:{width:job.logicalWidth,height:job.logicalHeight},serviceWorkers:'block'});await context.route('**/*',r=>r.abort());const page=await context.newPage();
 await page.setContent(`<canvas width="${job.logicalWidth}" height="${job.logicalHeight}"></canvas>`);
 await page.evaluate(async({source,fonts,job})=>{
  const caption=await import('data:text/javascript;base64,'+source),canvas=document.querySelector('canvas'),ctx=canvas.getContext('2d');
  for(const font of fonts){const face=new FontFace(font.family,'url(data:font/ttf;base64,'+font.data+')');document.fonts.add(await face.load())}await document.fonts.ready;
  const layouts=job.cues.map(cue=>caption.layoutBookCaption(cue.text,{safeBox:job.safeBox,measure:(text,family,size)=>{ctx.font=`${size}px "${family}"`;return ctx.measureText(text).width}}));
  window.renderCaption=frame=>{ctx.reset();const timeMs=frame*1000/job.fps;for(let i=0;i<job.cues.length;i++)caption.drawBookCaption(ctx,layouts[i],job.cues[i],timeMs);return canvas.toDataURL('image/png').split(',')[1]};
 },{source:source.toString('base64'),fonts,job});
 const samples=[0,Math.floor(job.frames/2),job.frames-1],baseline=new Map();
 for(const frame of samples)baseline.set(frame,sha(Buffer.from(await page.evaluate(f=>window.renderCaption(f),frame),'base64')));
 for(const frame of samples.toReversed())if(sha(Buffer.from(await page.evaluate(f=>window.renderCaption(f),frame),'base64'))!==baseline.get(frame))throw Error('BOOK_CAPTION_NONDETERMINISTIC');
 encoder=spawn('ffmpeg',['-v','error','-xerror','-nostdin','-threads','2','-filter_threads','2','-f','image2pipe','-framerate',String(job.fps),'-vcodec','png','-i','pipe:0','-vf',`scale=${job.width}:${job.height}:flags=lanczos`,'-c:v','qtrle','-pix_fmt','argb','-an','-y','/output/captions.mov'],{stdio:['pipe','ignore','pipe']});
 const encoded=new Promise((resolve,reject)=>{encoder.once('error',reject);encoder.once('close',code=>code===0?resolve():reject(Error('BOOK_CAPTION_ENCODE_FAILED')))});encoded.catch(()=>{});let encoderError;encoder.stdin.on('error',error=>{encoderError=error});encoder.stderr.on('data',()=>{});
 for(let frame=0;frame<job.frames;frame++){
  if(encoderError)throw encoderError;const png=Buffer.from(await page.evaluate(f=>window.renderCaption(f),frame),'base64');if(!encoder.stdin.write(png))await once(encoder.stdin,'drain');
 }
 encoder.stdin.end();await encoded;encoder=null;await browser.close();browser=null;
 await command(['-v','error','-xerror','-nostdin','-threads','2','-i','/output/captions.mov','-f','null','-']);
 const {stdout}=await exec('ffprobe',['-v','error','-count_frames','-show_streams','-show_format','-of','json','/output/captions.mov'],{timeout:120000,maxBuffer:1048576}),probe=JSON.parse(stdout),video=probe.streams[0],rate=video?.avg_frame_rate?.split('/').map(Number);
 if(probe.streams.length!==1||video.codec_name!=='qtrle'||video.pix_fmt!=='argb'||video.width!==job.width||video.height!==job.height||Number(video.nb_read_frames)!==job.frames||rate[0]/rate[1]!==job.fps||Math.abs(Number(probe.format.duration)-job.frames/job.fps)>1/job.fps)throw Error('BOOK_CAPTION_METADATA_INVALID');
 const path='/output/captions.mov',bytes=await readFile(path);if(bytes.length>512*1024*1024)throw Error('BOOK_CAPTION_OUTPUT_LIMIT');
 const receipt={schemaVersion:1,jobSha256:key,rendererSha256:job.rendererSha256,outputSha256:sha(bytes),outputBytes:(await stat(path)).size,frames:Number(video.nb_read_frames),width:video.width,height:video.height,fps:rate[0]/rate[1]};
 const file=await open('/output/receipt.tmp','wx');try{await file.writeFile(JSON.stringify(receipt));await file.sync()}finally{await file.close()}await rename('/output/receipt.tmp','/output/receipt.json');const dir=await open('/output','r');try{await dir.sync()}finally{await dir.close()}console.log(JSON.stringify(receipt));
}catch(error){await writeFile('/output/failure.json',JSON.stringify({errorCode:String(error.message).split('\n')[0].slice(0,300)})).catch(()=>{});throw error}
finally{encoder?.kill('SIGKILL');await browser?.close()}
