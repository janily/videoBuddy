import {join,resolve} from 'node:path';
import {readFile,rm} from 'node:fs/promises';
import {z} from 'zod';
import {canonicalHash} from '@/services/video/domain/hash';
import type {ImageInput,PreparedImage,MediaOptions} from '../runtime';
import type {LocalContext} from './renderer';
import {browserDeadline} from './browser';
import {assertNotAborted,runProcess} from './ffmpeg';
import {durableWrite,fileIdentity,publishDirectory,serialized,sha256,temporaryStage,verifiedBytes} from './files';
export async function prepareImage(runtime:LocalContext,input:ImageInput,options:MediaOptions={}):Promise<PreparedImage>{
 if(!z.uuid().safeParse(input.projectId).success||!z.uuid().safeParse(input.assetId).success||!['image/png','image/jpeg','image/webp'].includes(input.sourceMime)||!/^[a-f0-9]{64}$/.test(input.sourceSha256)||!Number.isSafeInteger(input.sourceBytes)||input.sourceBytes<1||input.sourceBytes>20*1024*1024||input.maxEdge!==undefined&&input.maxEdge!==2048)throw Error('IMAGE_INPUT_INVALID');
 // Only the owned upload slot is accepted, never an arbitrary client URL/path.
 if(resolve(input.sourcePath)!==join(runtime.root,'assets',input.projectId,input.assetId+'.bin'))throw Error('IMAGE_INPUT_INVALID');
 const identity={version:'local-image-v1',projectId:input.projectId,assetId:input.assetId,sourceSha256:input.sourceSha256,sourceBytes:input.sourceBytes,sourceMime:input.sourceMime,maxEdge:2048,runtimeDigest:runtime.runtimeDigest},key=canonicalHash(identity),parent=join(runtime.root,'media','image-preparation'),stage=join(parent,key);
 return serialized(stage,async()=>{
  assertNotAborted(options.signal);
  const original=await verifiedBytes(input.sourcePath,{sha256:input.sourceSha256,bytes:input.sourceBytes},20*1024*1024);
  let cached:{identity:typeof identity;result:PreparedImage;manifestHash:string}|undefined;try{cached=JSON.parse(await readFile(join(stage,'manifest.json'),'utf8'))}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error}
  if(cached){const {manifestHash,...record}=cached;if(canonicalHash(record)!==manifestHash)throw Error('MEDIA_CACHE_INVALID');if(canonicalHash(cached.identity)!==key||cached.result?.key!==key||cached.result.runtimeDigest!==runtime.runtimeDigest||cached.result.outputPath!==join(stage,'view.png'))throw Error('MEDIA_CACHE_INVALID');await fileIdentity(cached.result.outputPath,cached.result);return cached.result}
  const temp=await temporaryStage(parent,key);let context:Awaited<ReturnType<LocalContext['pool']['context']>>|undefined;
  try{
   // Probe only the verified snapshot; generated image bytes never become code.
   const snapshot=join(temp,'source.bin');await durableWrite(snapshot,original);
   const raw=JSON.parse((await runProcess(runtime.ffprobe,['-v','error','-max_alloc','268435456','-protocol_whitelist','file,pipe','-select_streams','v:0','-show_entries','stream=width,height,codec_name','-of','json',snapshot],{signal:options.signal,timeoutMs:10000,maxOutputBytes:65536})).stdout) as {streams:{width:number;height:number;codec_name:string}[]};
   if(raw.streams?.length!==1)throw Error('IMAGE_DECODE_FAILED');const {width:encodedWidth,height:encodedHeight,codec_name:codec}=raw.streams[0];
   if(![encodedWidth,encodedHeight].every(n=>Number.isSafeInteger(n)&&n>0)||encodedWidth>65536||encodedHeight>65536||encodedWidth*encodedHeight>30_000_000)throw Error('IMAGE_PIXEL_LIMIT');
   if(codec==='apng')throw Error('IMAGE_ANIMATION_UNSUPPORTED');if(codec!==({'image/png':'png','image/jpeg':'mjpeg','image/webp':'webp'}[input.sourceMime]))throw Error('IMAGE_DECODE_FAILED');
   if(input.sourceMime==='image/webp')for(let offset=12;offset+8<=original.length;){const kind=original.toString('ascii',offset,offset+4),size=original.readUInt32LE(offset+4);if(kind==='ANIM'||kind==='ANMF')throw Error('IMAGE_ANIMATION_UNSUPPORTED');offset+=8+size+(size%2)}
   context=await browserDeadline(async()=>{const created=await runtime.pool.context();if(options.signal?.aborted){await runtime.pool.release(created);throw Error('MEDIA_ABORTED')}context=created;return created},runtime.pool,30000,options.signal,'IMAGE_RUNTIME_ERROR');await context.route('**/*',route=>route.abort());await context.routeWebSocket('**/*',ws=>ws.close());const page=await context.newPage();
   const decoded=await browserDeadline(()=>page.evaluate(async({url})=>{const image=new Image();image.src=url;await image.decode();const orientedWidth=image.naturalWidth,orientedHeight=image.naturalHeight;if(!orientedWidth||!orientedHeight||orientedWidth*orientedHeight>30_000_000)throw Error('IMAGE_PIXEL_LIMIT');const scale=Math.min(1,2048/Math.max(orientedWidth,orientedHeight)),width=Math.max(1,Math.round(orientedWidth*scale)),height=Math.max(1,Math.round(orientedHeight*scale)),canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;const ctx=canvas.getContext('2d');if(!ctx)throw Error('IMAGE_DECODE_FAILED');ctx.drawImage(image,0,0,width,height);return{orientedWidth,orientedHeight,width,height,png:canvas.toDataURL('image/png').slice('data:image/png;base64,'.length)}},{url:`data:${input.sourceMime};base64,${original.toString('base64')}`}),runtime.pool,10000,options.signal,'IMAGE_RUNTIME_ERROR',context);
   const {orientedWidth:ow,orientedHeight:oh,width,height}=decoded;if(!((ow===encodedWidth&&oh===encodedHeight)||(ow===encodedHeight&&oh===encodedWidth)))throw Error('IMAGE_DECODE_FAILED');
   const data=Buffer.from(decoded.png,'base64');if(data.length>20*1024*1024||data.subarray(0,8).toString('hex')!=='89504e470d0a1a0a')throw Error('IMAGE_DECODE_FAILED');
   await fileIdentity(input.sourcePath,{sha256:input.sourceSha256,bytes:input.sourceBytes});assertNotAborted(options.signal);
   const result:PreparedImage={key,outputPath:join(stage,'view.png'),sha256:sha256(data),bytes:data.length,width,height,encodedWidth,encodedHeight,orientedWidth:ow,orientedHeight:oh,runtimeDigest:runtime.runtimeDigest,mime:'image/png',transform:'full_image_resize',coordinates:'oriented_image_normalized'};
   await durableWrite(join(temp,'view.png'),data);await rm(snapshot);await durableWrite(join(temp,'manifest.json'),JSON.stringify({identity,result,manifestHash:canonicalHash({identity,result})}));assertNotAborted(options.signal);await publishDirectory(temp,stage);await fileIdentity(result.outputPath,result);return result;
  }finally{if(context)await runtime.pool.release(context);await rm(temp,{recursive:true,force:true})}
 });
}
