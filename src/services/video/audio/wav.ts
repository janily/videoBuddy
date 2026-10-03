import {createHash} from 'node:crypto';
import {lstat,readFile} from 'node:fs/promises';

export interface VoiceWavProbe{
 codec:'pcm_f32le';sampleRate:24000;channels:1;samples:number;durationMs:number;bytes:number;sha256:string;peakDbfs:number;rmsDbfs:number;
}
export interface TrackWavProbe{
 codec:'pcm_f32le';sampleRate:48000;channels:1;samples:number;durationMs:number;bytes:number;sha256:string;peakDbfs:number|null;rmsDbfs:number|null;silence:boolean;
}
function probeFloatWav(bytes:Buffer,sampleRate:24000|48000,maxBytes:number,channels:1|2=1,maxAmplitude=1){
 if(bytes.length<44||bytes.length>maxBytes||bytes.toString('ascii',0,4)!=='RIFF'||bytes.toString('ascii',8,12)!=='WAVE'||bytes.readUInt32LE(4)+8!==bytes.length)throw Error('AUDIO_OUTPUT_INVALID');
 let offset=12,format:Buffer|undefined,data:Buffer|undefined;
 while(offset+8<=bytes.length){
  const id=bytes.toString('ascii',offset,offset+4),length=bytes.readUInt32LE(offset+4),start=offset+8,end=start+length;
  if(end>bytes.length)throw Error('AUDIO_OUTPUT_INVALID');
  if(id==='fmt ')format=bytes.subarray(start,end);
  if(id==='data')data=bytes.subarray(start,end);
  offset=end+(length%2);
 }
 const floatFormat=!!format&&format.length>=16&&(format.readUInt16LE(0)===3||
  (format.length===40&&format.readUInt16LE(0)===0xfffe&&format.readUInt16LE(16)===22&&format.readUInt16LE(18)===32&&format.readUInt32LE(20)===(channels===1?4:3)&&format.subarray(24,40).equals(Buffer.from('0300000000001000800000aa00389b71','hex'))));
 if(offset!==bytes.length||!format||format.length<16||!data||data.length<1024||data.length%(4*channels)||!floatFormat||format.readUInt16LE(2)!==channels||format.readUInt32LE(4)!==sampleRate||format.readUInt32LE(8)!==sampleRate*4*channels||format.readUInt16LE(12)!==4*channels||format.readUInt16LE(14)!==32)throw Error('AUDIO_OUTPUT_INVALID');
 const samples=data.length/(4*channels),durationMs=samples/(sampleRate/1000);
 let peak=0,sum=0;
 for(let i=0;i<samples*channels;i++){
  const value=data.readFloatLE(i*4);
  if(!Number.isFinite(value)||Math.abs(value)>maxAmplitude)throw Error('AUDIO_OUTPUT_INVALID');
  peak=Math.max(peak,Math.abs(value));sum+=value*value;
 }
 const rms=Math.sqrt(sum/(samples*channels));
 return{codec:'pcm_f32le' as const,sampleRate,channels,samples,durationMs,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),peakDbfs:peak?20*Math.log10(peak):null,rmsDbfs:rms?20*Math.log10(rms):null,silence:rms<0.001||peak<0.005};
}
export function probeVoiceWav(bytes:Buffer):VoiceWavProbe{
 let result:ReturnType<typeof probeFloatWav>;
 try{result=probeFloatWav(bytes,24000,20*1024*1024)}catch{throw Error('VOICE_OUTPUT_INVALID')}
 if(result.durationMs<200||result.durationMs>30000)throw Error('VOICE_DURATION_INVALID');
 if(result.silence||result.peakDbfs===null||result.rmsDbfs===null)throw Error('VOICE_SILENT');
 return{codec:'pcm_f32le',sampleRate:24000,channels:1,samples:result.samples,durationMs:result.durationMs,bytes:result.bytes,sha256:result.sha256,peakDbfs:result.peakDbfs,rmsDbfs:result.rmsDbfs};
}
export function probeTrackWav(bytes:Buffer,expectedSamples:number,allowSilence:boolean,toleranceSamples=0):TrackWavProbe{
 let result:ReturnType<typeof probeFloatWav>;
 try{result=probeFloatWav(bytes,48000,32*1024*1024)}catch{throw Error('AUDIO_OUTPUT_INVALID')}
 if(!Number.isSafeInteger(expectedSamples)||expectedSamples<48000||expectedSamples>120*48000||!Number.isSafeInteger(toleranceSamples)||toleranceSamples<0||toleranceSamples>1024||Math.abs(result.samples-expectedSamples)>toleranceSamples)throw Error(`AUDIO_DURATION_INVALID: expected ${expectedSamples}, actual ${result.samples}`);
 if(result.silence&&!allowSilence)throw Error('AUDIO_SILENT');
 return{...result,sampleRate:48000,channels:1};
}
export type StereoTrackWavProbe=Omit<TrackWavProbe,'channels'>&{channels:2};
export function probeStereoTrackWav(bytes:Buffer,expectedSamples:number,allowSilence:boolean):StereoTrackWavProbe{
 const result=probeFloatWav(bytes,48000,64*1024*1024,2,16);
 if(!Number.isSafeInteger(expectedSamples)||expectedSamples<48000||expectedSamples>120*48000||result.samples!==expectedSamples)throw Error('AUDIO_DURATION_INVALID');
 // Sparse Foley can have arbitrarily low whole-film RMS. Only exact zero PCM is silent here.
 const silence=result.peakDbfs===null;
 if(silence&&!allowSilence)throw Error('AUDIO_SILENT');
 return{...result,sampleRate:48000,channels:2,silence};
}
export async function inspectStereoTrackWav(path:string,expectedSamples:number,allowSilence:boolean){
 const info=await lstat(path);if(!info.isFile()||info.isSymbolicLink()||info.nlink!==1||info.size>64*1024*1024)throw Error('AUDIO_OUTPUT_INVALID');
 return probeStereoTrackWav(await readFile(path),expectedSamples,allowSilence);
}
export async function inspectVoiceWav(path:string){
 const info=await lstat(path);if(!info.isFile()||info.isSymbolicLink()||info.nlink!==1||info.size>20*1024*1024)throw Error('VOICE_OUTPUT_INVALID');
 return probeVoiceWav(await readFile(path));
}
export async function inspectTrackWav(path:string,expectedSamples:number,allowSilence:boolean,toleranceSamples=0){
 const info=await lstat(path);if(!info.isFile()||info.isSymbolicLink()||info.nlink!==1||info.size>32*1024*1024)throw Error('AUDIO_OUTPUT_INVALID');
 return probeTrackWav(await readFile(path),expectedSamples,allowSilence,toleranceSamples);
}
