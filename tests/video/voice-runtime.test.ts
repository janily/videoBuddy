import {describe,expect,it} from 'vitest';
import {mkdir,mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {probeVoiceWav,inspectVoiceWav} from '@/services/video/audio/wav';
import {voiceConfiguration,voiceStageKey,voiceDockerArguments,synthesizeVoice} from '@/services/video/audio/voice';

function wav(samples=24000,amplitude=0.1){
 const data=Buffer.alloc(samples*4);for(let i=0;i<samples;i++)data.writeFloatLE(Math.sin(i*0.1)*amplitude,i*4);
 const result=Buffer.alloc(44+data.length);result.write('RIFF',0);result.writeUInt32LE(result.length-8,4);result.write('WAVEfmt ',8);
 result.writeUInt32LE(16,16);result.writeUInt16LE(3,20);result.writeUInt16LE(1,22);result.writeUInt32LE(24000,24);result.writeUInt32LE(96000,28);
 result.writeUInt16LE(4,32);result.writeUInt16LE(32,34);result.write('data',36);result.writeUInt32LE(data.length,40);data.copy(result,44);return result;
}
describe('offline voice output',()=>{
 it('does not create a missing job when reading existing audio as evidence',async()=>{
  const root=await mkdtemp(join(tmpdir(),'vb-voice-readonly-'));
  try{
   const digest='a'.repeat(64),job={lineId:'line_1',language:'zh-CN' as const,text:'十月八日开始。'},key=voiceStageKey(job,digest),stage=join(root,'voice',key);
   await mkdir(join(stage,'output'),{recursive:true});await writeFile(join(stage,'output/narration.wav'),wav());
   await expect(synthesizeVoice(root,job,{VIDEO_VOICE_IMAGE_REF:'sha256:'+digest,VIDEO_VOICE_RUNTIME_DIGEST:digest},{mustExist:true})).rejects.toThrow('VOICE_EVIDENCE_MISSING');
   await expect(readFile(join(stage,'job.json'))).rejects.toMatchObject({code:'ENOENT'});
  }finally{await rm(root,{recursive:true,force:true})}
 });
 it('measures the actual float WAV samples and rejects silence and NaN',()=>{
  expect(probeVoiceWav(wav()).durationMs).toBe(1000);
  expect(probeVoiceWav(wav()).sampleRate).toBe(24000);
  expect(()=>probeVoiceWav(wav(24000,0))).toThrow('VOICE_SILENT');
  const invalid=wav();invalid.writeFloatLE(Number.NaN,44);expect(()=>probeVoiceWav(invalid)).toThrow('VOICE_OUTPUT_INVALID');
  const wrongRate=wav();wrongRate.writeUInt32LE(48000,24);expect(()=>probeVoiceWav(wrongRate)).toThrow('VOICE_OUTPUT_INVALID');
 });
 it('rejects a symlink as a container output',async()=>{
  const {symlink}=await import('node:fs/promises'),root=await mkdtemp(join(tmpdir(),'vb-voice-test-'));
  try{await writeFile(join(root,'real.wav'),wav());await symlink(join(root,'real.wav'),join(root,'link.wav'));
   await expect(inspectVoiceWav(join(root,'link.wav'))).rejects.toThrow('VOICE_OUTPUT_INVALID');
  }finally{await rm(root,{recursive:true,force:true})}
 });
 it('pins the runtime and binds only a trusted job and output',()=>{
  const digest='a'.repeat(64),config=voiceConfiguration({VIDEO_VOICE_IMAGE_REF:`sha256:${digest}`,VIDEO_VOICE_RUNTIME_DIGEST:digest});
  const key=voiceStageKey({lineId:'line_1',language:'zh-CN',text:'十月八日开始。'},digest);
  const args=voiceDockerArguments(config,'/var/lib/videobuddy/voice/'+key,key);
  expect(args).toContain('--network');expect(args).toContain('none');expect(args).toContain('--read-only');expect(args).toContain('--cap-drop');expect(args).toContain('ALL');
  expect(args.join(' ')).not.toMatch(/MODEL_API_KEY|BLOB_READ_WRITE_TOKEN|VERCEL/);
  expect(args.filter(part=>part.includes('readonly'))).toHaveLength(1);
  expect(voiceStageKey({lineId:'line_1',language:'zh-CN',text:'十月九日开始。'},digest)).not.toBe(key);
  expect(()=>voiceConfiguration({VIDEO_VOICE_IMAGE_REF:'videobuddy-voice:latest'})).toThrow('VOICE_RUNTIME_UNAVAILABLE');
 });
});
