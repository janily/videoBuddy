import {createHash} from 'node:crypto';
import {lstat,readFile} from 'node:fs/promises';

export interface VoiceWavProbe{
 codec:'pcm_f32le';sampleRate:24000;channels:1;samples:number;durationMs:number;bytes:number;sha256:string;peakDbfs:number;rmsDbfs:number;
}
export function probeVoiceWav(bytes:Buffer):VoiceWavProbe{
 if(bytes.length<44||bytes.length>20*1024*1024||bytes.toString('ascii',0,4)!=='RIFF'||bytes.toString('ascii',8,12)!=='WAVE'||bytes.readUInt32LE(4)+8!==bytes.length)throw Error('VOICE_OUTPUT_INVALID');
 let offset=12,format:Buffer|undefined,data:Buffer|undefined;
 while(offset+8<=bytes.length){
  const id=bytes.toString('ascii',offset,offset+4),length=bytes.readUInt32LE(offset+4),start=offset+8,end=start+length;
  if(end>bytes.length)throw Error('VOICE_OUTPUT_INVALID');
  if(id==='fmt ')format=bytes.subarray(start,end);
  if(id==='data')data=bytes.subarray(start,end);
  offset=end+(length%2);
 }
 if(offset!==bytes.length||!format||format.length<16||!data||data.length<1024||data.length%4||format.readUInt16LE(0)!==3||format.readUInt16LE(2)!==1||format.readUInt32LE(4)!==24000||format.readUInt32LE(8)!==96000||format.readUInt16LE(12)!==4||format.readUInt16LE(14)!==32)throw Error('VOICE_OUTPUT_INVALID');
 const samples=data.length/4,durationMs=samples/24;
 if(durationMs<200||durationMs>30000)throw Error('VOICE_DURATION_INVALID');
 let peak=0,sum=0;
 for(let i=0;i<samples;i++){
  const value=data.readFloatLE(i*4);
  if(!Number.isFinite(value)||Math.abs(value)>1)throw Error('VOICE_OUTPUT_INVALID');
  peak=Math.max(peak,Math.abs(value));sum+=value*value;
 }
 const rms=Math.sqrt(sum/samples);
 if(rms<0.001||peak<0.005)throw Error('VOICE_SILENT');
 return{codec:'pcm_f32le',sampleRate:24000,channels:1,samples,durationMs,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),peakDbfs:20*Math.log10(peak),rmsDbfs:20*Math.log10(rms)};
}
export async function inspectVoiceWav(path:string){
 const info=await lstat(path);if(!info.isFile()||info.isSymbolicLink()||info.nlink!==1||info.size>20*1024*1024)throw Error('VOICE_OUTPUT_INVALID');
 return probeVoiceWav(await readFile(path));
}
