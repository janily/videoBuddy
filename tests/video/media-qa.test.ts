import {expect,it,vi} from 'vitest';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const {processResult}=vi.hoisted(()=>({processResult:{stdout:'',stderr:''}}));
vi.mock('@/services/video/media/local/ffmpeg',()=>({runProcess:async()=>processResult}));
vi.mock('@/services/video/media/local/files',()=>({fileIdentity:async()=>({sha256:'a'.repeat(64),bytes:24})}));
import {assertMp4Faststart,probeVideo} from '@/services/video/media/local/probe';
async function validateVideoProbe(raw:unknown,expected:{width:number;height:number;durationSec:number;fps:number;audio:boolean;audioChannels?:number}){
 const root=await mkdtemp(join(tmpdir(),'vb-probe-')),path=join(root,'film.mp4');
 const atom=(type:string)=>{const result=Buffer.alloc(8);result.writeUInt32BE(8,0);result.write(type,4);return result};
 try{await writeFile(path,Buffer.concat(['ftyp','moov','mdat'].map(atom)));processResult.stdout=JSON.stringify(raw);return await probeVideo(path,'ffprobe',{fullDecode:true,expected})}finally{await rm(root,{recursive:true,force:true})}
}

const expected={width:320,height:180,durationSec:1,fps:24,audio:false};
const valid={streams:[{codec_type:'video',codec_name:'h264',pix_fmt:'yuv420p',color_primaries:'bt709',color_transfer:'bt709',color_space:'bt709',width:320,height:180,avg_frame_rate:'24/1',nb_read_frames:'24'}],format:{duration:'1.000000'}};
it('accepts a decoded video only when its actual metadata matches the render contract',async()=>{
 expect(await validateVideoProbe(valid,expected)).toMatchObject({width:320,height:180,durationSec:1,fps:24});
 await expect(validateVideoProbe({...valid,streams:[{...valid.streams[0],height:181}]},expected)).rejects.toThrow('QA_FAILED');
 await expect(validateVideoProbe({...valid,format:{duration:'0.500000'}},expected)).rejects.toThrow('QA_FAILED');
 await expect(validateVideoProbe({...valid,streams:[{...valid.streams[0],nb_read_frames:'23'}]},expected)).rejects.toThrow('QA_FAILED');
 await expect(validateVideoProbe({...valid,streams:[{...valid.streams[0],color_space:'bt601'}]},expected)).rejects.toThrow('QA_FAILED');
 await expect(validateVideoProbe({...valid,streams:[{...valid.streams[0],pix_fmt:'yuv444p'}]},expected)).rejects.toThrow('QA_FAILED');
 await expect(validateVideoProbe({...valid,streams:[valid.streams[0],{codec_type:'audio',codec_name:'aac'}]},expected)).rejects.toThrow('QA_FAILED');
});
it('requires the MP4 index before media data for faststart',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'vb-atoms-'));
 const atom=(type:string)=>{const result=Buffer.alloc(8);result.writeUInt32BE(8,0);result.write(type,4);return result};
 try{
  const good=Buffer.concat([atom('ftyp'),atom('moov'),atom('mdat')]),bad=Buffer.concat([atom('ftyp'),atom('mdat'),atom('moov')]);
  const path=join(dir,'film.mp4');await writeFile(path,good);await expect(assertMp4Faststart(path,good.length)).resolves.toBeUndefined();
  await writeFile(path,bad);await expect(assertMp4Faststart(path,bad.length)).rejects.toThrow('QA_FAILED: faststart');
 }finally{await rm(dir,{recursive:true,force:true})}
});
it('requires AAC at 48 kHz when a completed film has an audio track',async()=>{
 const film={...valid,streams:[valid.streams[0],{codec_type:'audio',codec_name:'aac',sample_rate:'48000',channels:2}]};
 expect(await validateVideoProbe(film,{...expected,audio:true})).toMatchObject({audio:true});
 await expect(validateVideoProbe({...film,streams:[valid.streams[0],{codec_type:'audio',codec_name:'mp3',sample_rate:'48000',channels:2}]},{...expected,audio:true})).rejects.toThrow('QA_FAILED');
 await expect(validateVideoProbe({...film,streams:[valid.streams[0],{codec_type:'audio',codec_name:'aac',sample_rate:'24000',channels:2}]},{...expected,audio:true})).rejects.toThrow('QA_FAILED');
});
it('rejects a collapsed mono delivery when the declared master is stereo',async()=>{
 const film={...valid,streams:[valid.streams[0],{codec_type:'audio',codec_name:'aac',sample_rate:'48000',channels:1}]};
 await expect(validateVideoProbe(film,{...expected,audio:true,audioChannels:2})).rejects.toThrow('QA_FAILED');
 expect(await validateVideoProbe({...film,streams:[valid.streams[0],{codec_type:'audio',codec_name:'aac',sample_rate:'48000',channels:2}]},{...expected,audio:true,audioChannels:2})).toMatchObject({audioChannels:2});
});
