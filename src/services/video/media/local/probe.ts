import {open} from 'node:fs/promises';
import type {ProbeOptions,VideoProbe} from '../runtime';
import {fileIdentity} from './files';
import {runProcess} from './ffmpeg';
export async function assertMp4Faststart(path:string,size:number){
 const file=await open(path,'r');let offset=0,ftyp=false,moov=false,mdat=false;
 try{while(offset+8<=size){const header=Buffer.alloc(16),{bytesRead}=await file.read(header,0,16,offset);if(bytesRead<8)throw Error('QA_FAILED: MP4 atoms');const type=header.toString('ascii',4,8),small=header.readUInt32BE(0),headerSize=small===1?16:8;if(bytesRead<headerSize)throw Error('QA_FAILED: MP4 atoms');const atomSize=small===0?size-offset:small===1?Number(header.readBigUInt64BE(8)):small;if(!Number.isSafeInteger(atomSize)||atomSize<headerSize||offset+atomSize>size)throw Error('QA_FAILED: MP4 atoms');if(offset===0&&type!=='ftyp')throw Error('QA_FAILED: MP4 signature');if(type==='ftyp')ftyp=true;if(type==='moov')moov=true;if(type==='mdat'){mdat=true;if(!moov)throw Error('QA_FAILED: faststart')}offset+=atomSize}}finally{await file.close()}
 if(offset!==size||!ftyp||!moov||!mdat)throw Error('QA_FAILED: MP4 atoms');
}
export async function probeVideo(path:string,ffprobe:string,options:ProbeOptions={}):Promise<VideoProbe>{
 const identity=await fileIdentity(path);await assertMp4Faststart(path,identity.bytes);
 const {stdout,stderr}=await runProcess(ffprobe,['-v','error','-threads','2',...(options.fullDecode?['-count_frames']:[]),'-show_entries','stream=codec_type,codec_name,width,height,duration,avg_frame_rate,nb_frames,nb_read_frames,pix_fmt,color_primaries,color_transfer,color_space,sample_rate,channels:format=duration:format_tags','-of','json',path],{signal:options.signal});
 if(stderr.trim())throw Error('QA_FAILED: decoder error');
 const raw=JSON.parse(stdout) as {streams:Array<{codec_type:string;codec_name:string;width:number;height:number;duration:string;avg_frame_rate:string;nb_frames:string;nb_read_frames:string;pix_fmt:string;color_primaries:string;color_transfer:string;color_space:string;sample_rate:string;channels:number}>;format:{duration:string;tags?:Record<string,string>}};
 const videos=raw.streams?.filter(s=>s.codec_type==='video'),audios=raw.streams?.filter(s=>s.codec_type==='audio');if(videos?.length!==1||!audios||audios.length>1||raw.streams.length!==videos.length+audios.length)throw Error('QA_FAILED: streams');
 const v=videos[0],a=audios[0],rate=v.avg_frame_rate?.split('/').map(Number),fps=rate?.length===2?rate[0]/rate[1]:NaN,frameCount=Number(options.fullDecode?v.nb_read_frames:v.nb_frames),durationSec=Number(v.duration||raw.format.duration);
 if(v.codec_name!=='h264'||v.pix_fmt!=='yuv420p'||v.color_primaries!=='bt709'||v.color_transfer!=='bt709'||v.color_space!=='bt709'||![v.width,v.height,frameCount].every(n=>Number.isSafeInteger(n)&&n>0)||!Number.isFinite(fps)||fps<=0||!Number.isFinite(durationSec)||durationSec<=0||a&&(a.codec_name!=='aac'||a.sample_rate!=='48000'||a.channels!==2))throw Error('QA_FAILED: media metadata');
 const e=options.expected;if(e&&(v.width!==e.width||v.height!==e.height||Math.abs(fps-e.fps)>0.001||frameCount!==Math.round(e.durationSec*e.fps)||Math.abs(durationSec-e.durationSec)>1/e.fps||Boolean(a)!==e.audio))throw Error('QA_FAILED: expected metadata');
 return{...identity,width:v.width,height:v.height,durationSec,fps,frameCount,audio:Boolean(a),...(a?{audioChannels:a.channels,audioCodec:a.codec_name,sampleRate:Number(a.sample_rate)}:{}),videoCodec:v.codec_name,pixelFormat:v.pix_fmt,colorSpace:v.color_space,tags:raw.format.tags||{}};
}
