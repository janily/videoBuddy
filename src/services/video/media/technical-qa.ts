import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {lstat,open,realpath} from 'node:fs/promises';
import {isAbsolute,join} from 'node:path';
import {z} from 'zod';
import {validateOutputPath} from './executor';

const probeSchema=z.object({streams:z.array(z.object({codec_type:z.string(),codec_name:z.string(),width:z.number().optional(),height:z.number().optional(),avg_frame_rate:z.string().optional(),nb_read_frames:z.string().optional(),pix_fmt:z.string().optional(),color_primaries:z.string().optional(),color_transfer:z.string().optional(),color_space:z.string().optional(),sample_rate:z.string().optional(),channels:z.number().optional()})),format:z.object({duration:z.string()})});
export interface ExpectedVideo{width:number;height:number;durationSec:number;fps:number;audio:boolean;audioChannels?:1|2}
export function validateVideoProbe(raw:unknown,expected:ExpectedVideo){
 const probe=probeSchema.parse(raw),video=probe.streams.filter(stream=>stream.codec_type==='video'),audio=probe.streams.filter(stream=>stream.codec_type==='audio');
 const duration=Number(probe.format.duration),rate=video[0]?.avg_frame_rate?.split('/').map(Number),fps=rate?.length===2?rate[0]/rate[1]:NaN,frames=Number(video[0]?.nb_read_frames),expectedFrames=Math.round(expected.durationSec*expected.fps);
 if(video.length!==1||video[0].codec_name!=='h264'||video[0].pix_fmt!=='yuv420p'||video[0].color_primaries!=='bt709'||video[0].color_transfer!=='bt709'||video[0].color_space!=='bt709'||video[0].width!==expected.width||video[0].height!==expected.height||
  audio.length!==(expected.audio?1:0)||(expected.audio&&(audio[0].codec_name!=='aac'||audio[0].sample_rate!=='48000'||![1,2].includes(audio[0].channels??0)||expected.audioChannels!==undefined&&audio[0].channels!==expected.audioChannels))||expected.audioChannels!==undefined&&!expected.audio||!Number.isFinite(duration)||Math.abs(duration-expected.durationSec)>1/expected.fps||
  !Number.isFinite(fps)||Math.abs(fps-expected.fps)>0.001||!Number.isSafeInteger(frames)||frames!==expectedFrames||Math.abs(expected.durationSec*expected.fps-expectedFrames)>0.001)throw Error('QA_FAILED: media metadata');
 return{width:video[0].width,height:video[0].height,durationSec:duration,fps,frames,audio:audio.length===1,...(expected.audioChannels!==undefined?{audioChannels:audio[0].channels}: {})};
}
export async function assertMp4Faststart(path:string,size:number){
 const file=await open(path,'r');let offset=0,ftyp=false,moov=false,mdat=false;
 try{
  while(offset+8<=size){
   const header=Buffer.alloc(16),{bytesRead}=await file.read(header,0,16,offset);
   if(bytesRead<8)throw Error('QA_FAILED: MP4 atoms');
   const type=header.toString('ascii',4,8),smallSize=header.readUInt32BE(0),headerSize=smallSize===1?16:8;
   if(bytesRead<headerSize)throw Error('QA_FAILED: MP4 atoms');
   const atomSize=smallSize===0?size-offset:smallSize===1?Number(header.readBigUInt64BE(8)):smallSize;
   if(!Number.isSafeInteger(atomSize)||atomSize<headerSize||offset+atomSize>size)throw Error('QA_FAILED: MP4 atoms');
   if(offset===0&&type!=='ftyp')throw Error('QA_FAILED: MP4 signature');
   if(type==='ftyp')ftyp=true;
   if(type==='moov')moov=true;
   if(type==='mdat'){mdat=true;if(!moov)throw Error('QA_FAILED: faststart')}
   offset+=atomSize;
  }
 }finally{await file.close()}
 if(offset!==size||!ftyp||!moov||!mdat)throw Error('QA_FAILED: MP4 atoms');
}

async function docker(args:string[]){
 const child=spawn('docker',args,{stdio:['ignore','pipe','pipe'],signal:AbortSignal.timeout(120000)}),out:Buffer[]=[],err:Buffer[]=[];
 child.stdout.on('data',(part:Buffer)=>{if(Buffer.concat(out).length<1024*1024)out.push(part)});
 child.stderr.on('data',(part:Buffer)=>{if(Buffer.concat(err).length<4096)err.push(part)});
 const code=await new Promise<number>((resolve,reject)=>{child.once('error',reject);child.once('close',value=>resolve(value??1))});
 if(code!==0)throw Error(`QA_FAILED: decoder ${Buffer.concat(err).toString('utf8').slice(0,256)}`);
 return Buffer.concat(out).toString('utf8');
}

export async function technicalVideoQa(stageDir:string,image:string,outputRelative:string,expected:ExpectedVideo){
 if(!isAbsolute(stageDir)||!/^\/[A-Za-z0-9_./-]+$/.test(stageDir)||!/^sha256:[a-f0-9]{64}$/.test(image))throw Error('QA_FAILED: invalid runtime');
 validateOutputPath({path:outputRelative,symlink:false,hardlinks:1},'output');
 const filePath=join(stageDir,outputRelative),file=await lstat(filePath),stageReal=await realpath(stageDir),fileReal=await realpath(filePath);
 if(!file.isFile()||file.isSymbolicLink()||file.nlink!==1||file.size<1024||!fileReal.startsWith(stageReal+'/'))throw Error('QA_FAILED: output path');
 const reader=await open(filePath,'r');let header:Buffer;
 try{header=Buffer.alloc(12);await reader.read(header,0,12,0)}finally{await reader.close()}
 if(header.toString('ascii',4,8)!=='ftyp')throw Error('QA_FAILED: MP4 signature');
 await assertMp4Faststart(filePath,file.size);
 const hash=createHash('sha256');for await(const chunk of createReadStream(filePath))hash.update(chunk);
 const mount=`type=bind,src=${stageDir},dst=/input,readonly`;
 const prefix=['run','--rm','--network','none','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges','--pids-limit','64','--cpus','2','--memory','1g','--mount',mount,image];
 const raw=await docker([...prefix,'ffprobe','-v','error','-count_frames','-show_entries','stream=codec_type,codec_name,width,height,avg_frame_rate,nb_read_frames,pix_fmt,color_primaries,color_transfer,color_space,sample_rate,channels:format=duration','-of','json',`/input/${outputRelative}`]);
 const metadata=validateVideoProbe(JSON.parse(raw),expected);
 await docker([...prefix,'ffmpeg','-nostdin','-v','error','-xerror','-threads','2','-filter_threads','2','-i',`/input/${outputRelative}`,'-map','0','-f','null','-']);
 return{result:'pass' as const,sha256:hash.digest('hex'),bytes:file.size,...metadata};
}
