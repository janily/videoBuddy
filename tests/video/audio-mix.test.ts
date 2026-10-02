import {expect,it} from 'vitest';
import {mixDockerArguments,mixStageKey} from '@/services/video/audio/mix';
import {probeTrackWav} from '@/services/video/audio/wav';
import type {NarrationManifest} from '@/services/video/audio/narration';

it('quantizes a 1000 ms narration offset to exactly 48000 output samples without shell execution',()=>{
 const args=mixDockerArguments('sha256:'+'a'.repeat(64),'1000:1000','/tmp/output',[{path:'/tmp/voice.wav',startMs:1000}],20000);
 expect(args.join(' ')).toContain('adelay=48000S');
 expect(args).toContain('--network');expect(args).toContain('none');expect(args).toContain('--read-only');
 expect(args.join(' ')).toContain('amix=inputs=2:duration=first:normalize=0[out]');
 expect(args.filter(part=>part.includes('readonly'))).toHaveLength(1);
 expect(()=>mixDockerArguments('latest','1000:1000','/tmp/output',[],20000)).toThrow('AUDIO_JOB_INVALID');
});
it('requires an exact 48 kHz sample count, and accepts intentional silence only when declared',()=>{
 const samples=48000,buffer=Buffer.alloc(44+samples*4);buffer.write('RIFF',0);buffer.writeUInt32LE(buffer.length-8,4);buffer.write('WAVEfmt ',8);buffer.writeUInt32LE(16,16);buffer.writeUInt16LE(3,20);buffer.writeUInt16LE(1,22);buffer.writeUInt32LE(48000,24);buffer.writeUInt32LE(192000,28);buffer.writeUInt16LE(4,32);buffer.writeUInt16LE(32,34);buffer.write('data',36);buffer.writeUInt32LE(samples*4,40);
 expect(probeTrackWav(buffer,samples,true).silence).toBe(true);
 expect(()=>probeTrackWav(buffer,samples,false)).toThrow('AUDIO_SILENT');
 expect(()=>probeTrackWav(buffer,samples+1,true)).toThrow('AUDIO_DURATION_INVALID');
 expect(probeTrackWav(buffer,samples+512,true,1024).samples).toBe(samples);
 expect(()=>probeTrackWav(buffer,samples+1025,true,1024)).toThrow('AUDIO_DURATION_INVALID');
 const extended=Buffer.alloc(68+samples*4);extended.write('RIFF',0);extended.writeUInt32LE(extended.length-8,4);extended.write('WAVEfmt ',8);extended.writeUInt32LE(40,16);extended.writeUInt16LE(0xfffe,20);extended.writeUInt16LE(1,22);extended.writeUInt32LE(48000,24);extended.writeUInt32LE(192000,28);extended.writeUInt16LE(4,32);extended.writeUInt16LE(32,34);extended.writeUInt16LE(22,36);extended.writeUInt16LE(32,38);extended.writeUInt32LE(4,40);Buffer.from('0300000000001000800000aa00389b71','hex').copy(extended,44);extended.write('data',60);extended.writeUInt32LE(samples*4,64);extended.writeFloatLE(0.1,68);
 expect(probeTrackWav(extended,samples,true).sampleRate).toBe(48000);
 extended.writeUInt32LE(1,44);expect(()=>probeTrackWav(extended,samples,true)).toThrow('AUDIO_OUTPUT_INVALID');
});
it('mix stage identity commits narration sample hashes and their positions',()=>{
 const manifest={durationMs:20000,lines:[{lineId:'one',startMs:1000,durationMs:4100,voice:{wav:{sha256:'b'.repeat(64)}}}]} as NarrationManifest;
 const key=mixStageKey(manifest,'a'.repeat(64));
 expect(mixStageKey({...manifest,lines:[{...manifest.lines[0],startMs:2000}]},'a'.repeat(64))).not.toBe(key);
 expect(mixStageKey({...manifest,lines:[{...manifest.lines[0],voice:{...manifest.lines[0].voice,wav:{...manifest.lines[0].voice.wav,sha256:'c'.repeat(64)}}}]},'a'.repeat(64))).not.toBe(key);
});
