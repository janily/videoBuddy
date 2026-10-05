// Trusted static-image decoder. Never execute source text or generated scenes.
import {chromium} from 'playwright';
import {createHash,randomUUID} from 'node:crypto';
import {constants} from 'node:fs';
import {open,readFile,mkdir,link,rm,lstat} from 'node:fs/promises';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
const canonical=value=>value!==null&&typeof value==='object'?(Array.isArray(value)?'['+value.map(canonical).join(',')+']':'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}'):JSON.stringify(value);
const hash=data=>createHash('sha256').update(data).digest('hex');
const jobPath=process.argv[2];if(!/^\/work\/[a-f0-9]{64}\/job\.json$/.test(jobPath))throw Error('INVALID_JOB');
const root=dirname(jobPath),job=JSON.parse(await readFile(jobPath,'utf8'));
const identity={schemaVersion:1,jobSha256:job.jobSha256,assetId:job.assetId,sourceSha256:job.sourceSha256,runtimeDigest:job.runtimeDigest,producerSha256:job.producerSha256};
let browser,receipt;
try{
 const {jobSha256,...input}=job;if(hash(Buffer.from(canonical(input)))!==jobSha256||root.split('/').at(-1)!==jobSha256)throw Error('IMAGE_INPUT_INVALID');
 if(job.schemaVersion!==1||job.maxEdge!==2048||!['image/png','image/jpeg','image/webp'].includes(job.sourceMime)||!Number.isSafeInteger(job.sourceBytes)||job.sourceBytes<1||job.sourceBytes>20*1024*1024||!/^sha256:[a-f0-9]{64}$/.test('sha256:'+job.runtimeDigest)||hash(await readFile(fileURLToPath(import.meta.url)))!==job.producerSha256)throw Error('IMAGE_INPUT_INVALID');
 const fd=await open('/input/image.bin',constants.O_RDONLY|constants.O_NOFOLLOW);let original;
 try{const stat=await fd.stat();if(!stat.isFile()||stat.nlink!==1||stat.size!==job.sourceBytes)throw Error('IMAGE_INPUT_CHANGED');original=await fd.readFile()}finally{await fd.close()}
 if(original.length!==job.sourceBytes||hash(original)!==job.sourceSha256)throw Error('IMAGE_INPUT_CHANGED');
 const probe=spawnSync('ffprobe',['-v','error','-max_alloc','268435456','-select_streams','v:0','-show_entries','stream=width,height,codec_name','-of','json','/input/image.bin'],{encoding:'utf8',timeout:10000,maxBuffer:65536});
 if(probe.status!==0)throw Error('IMAGE_DECODE_FAILED');const streams=JSON.parse(probe.stdout).streams;if(!Array.isArray(streams)||streams.length!==1)throw Error('IMAGE_DECODE_FAILED');
 const {width:encodedWidth,height:encodedHeight,codec_name:codec}=streams[0];if(![encodedWidth,encodedHeight].every(value=>Number.isSafeInteger(value)&&value>0))throw Error('IMAGE_DECODE_FAILED');if(encodedWidth>65536||encodedHeight>65536||encodedWidth*encodedHeight>30_000_000)throw Error('IMAGE_PIXEL_LIMIT');
 if(codec==='apng')throw Error('IMAGE_ANIMATION_UNSUPPORTED');if(codec!==({'image/png':'png','image/jpeg':'mjpeg','image/webp':'webp'}[job.sourceMime]))throw Error('IMAGE_DECODE_FAILED');
 // Reject animation containers rather than choosing a timing-dependent frame.
 if(job.sourceMime==='image/webp'){for(let offset=12;offset+8<=original.length;){const kind=original.toString('ascii',offset,offset+4),size=original.readUInt32LE(offset+4);if(kind==='ANIM'||kind==='ANMF')throw Error('IMAGE_ANIMATION_UNSUPPORTED');offset+=8+size+(size%2)}}
 browser=await chromium.launch({headless:true,executablePath:'/usr/bin/chromium',args:['--no-sandbox','--disable-dev-shm-usage']});const context=await browser.newContext({serviceWorkers:'block'});await context.route('**/*',route=>route.abort());const page=await context.newPage();
 const decoded=await page.evaluate(async({url,maxEdge})=>{try{const image=new Image();image.src=url;await image.decode();const orientedWidth=image.naturalWidth,orientedHeight=image.naturalHeight;if(!orientedWidth||!orientedHeight)return null;const scale=Math.min(1,maxEdge/Math.max(orientedWidth,orientedHeight)),width=Math.max(1,Math.round(orientedWidth*scale)),height=Math.max(1,Math.round(orientedHeight*scale)),canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;const ctx=canvas.getContext('2d');if(!ctx)return null;ctx.drawImage(image,0,0,width,height);return{orientedWidth,orientedHeight,width,height,png:canvas.toDataURL('image/png').slice('data:image/png;base64,'.length)}}catch{return null}},{url:'data:'+job.sourceMime+';base64,'+original.toString('base64'),maxEdge:job.maxEdge});
 if(!decoded)throw Error('IMAGE_DECODE_FAILED');const {orientedWidth:ow,orientedHeight:oh,width,height}=decoded;if(!((ow===encodedWidth&&oh===encodedHeight)||(ow===encodedHeight&&oh===encodedWidth)))throw Error('IMAGE_DECODE_FAILED');
 const data=Buffer.from(decoded.png,'base64');if(data.length>20*1024*1024||data.subarray(0,8).toString('hex')!=='89504e470d0a1a0a')throw Error('IMAGE_DECODE_FAILED');
 await browser.close();browser=null;
 if(hash(await readFile('/input/image.bin'))!==job.sourceSha256)throw Error('IMAGE_INPUT_CHANGED');
 const output=join(root,'output');await mkdir(output,{recursive:true});const outputInfo=await lstat(output);if(!outputInfo.isDirectory()||outputInfo.isSymbolicLink())throw Error('IMAGE_INPUT_CHANGED');const target=join(output,'view.png'),temp=join(output,randomUUID()+'.tmp'),file=await open(temp,'wx',0o600);
 try{await file.writeFile(data);await file.sync();await file.close();try{await link(temp,target)}catch(error){if(error.code!=='EEXIST')throw error;const stat=await lstat(target);if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||hash(await readFile(target))!==hash(data))throw Error('IMAGE_INPUT_CHANGED')}}finally{await file.close().catch(()=>{});await rm(temp,{force:true})}
 const directory=await open(output,'r');try{await directory.sync()}finally{await directory.close()}
 receipt={...identity,status:'pass',sourceMime:job.sourceMime,sourceBytes:job.sourceBytes,encodedWidth,encodedHeight,orientedWidth:ow,orientedHeight:oh,width,height,mime:'image/png',sha256:hash(data),bytes:data.length,transform:'full_image_resize',coordinates:'oriented_image_normalized'};
}catch(error){const code=error instanceof Error?error.message:'';receipt={...identity,status:'fail',errorCode:['IMAGE_INPUT_INVALID','IMAGE_INPUT_CHANGED','IMAGE_PIXEL_LIMIT','IMAGE_DECODE_FAILED','IMAGE_ANIMATION_UNSUPPORTED'].includes(code)?code:'IMAGE_RUNTIME_ERROR'}}
finally{await browser?.close()}
// A known content failure has a fixed normal-exit receipt, not an unknown stop.
console.log(JSON.stringify(receipt));
