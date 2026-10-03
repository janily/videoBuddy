import {it,expect} from 'vitest';
import {spawnSync} from 'node:child_process';
import {masterMixFilter} from '@/services/video/audio/master';
const mix={targetLufs:-14 as const,toleranceLu:1 as const,maxTruePeakDbtp:-1.2 as const,voiceGainDb:-3,duck:{thresholdDb:-24,ratio:5,attackMs:12,releaseMs:250}};
it('uses frozen duck and voice-gain settings, preserves stereo and bounds the exact sample count',()=>{
 const filter=masterMixFilter(mix,960000,true);
 expect(filter).toContain('channel_layouts=stereo');
 expect(filter).toContain('volume=-3dB');
 expect(filter).toContain('ratio=5:attack=12:release=250');
 expect(filter).toContain('sidechaincompress=');
 expect(filter).toContain('normalize=0');
 expect(filter).toContain('atrim=end_sample=960000');
 const noVoice=masterMixFilter(mix,960000,false);
 expect(noVoice).not.toContain('sidechaincompress');
 expect(noVoice).toContain('[voice][music][foley]amix');
 expect(()=>masterMixFilter({...mix,voiceGainDb:NaN},960000,true)).toThrow('AUDIO_MIX_INVALID');
 expect(()=>masterMixFilter(mix,959999.5,true)).toThrow('AUDIO_MIX_INVALID');
});
function validatePython(filter:string,voiceGainDb:number,hasVoice:boolean){
 const job={schemaVersion:1,planSha256:'a'.repeat(64),samples:960000,hasVoice,mix:{...mix,voiceGainDb},filter,inputSha256:{voice:'b'.repeat(64),music:'c'.repeat(64),foley:'d'.repeat(64)}};
 return spawnSync('python3',['-c',"import sys,json;sys.path.insert(0,'runtime/media');import master;master.validate(json.load(sys.stdin))"],{input:JSON.stringify(job),encoding:'utf8'});
}
it.each([true,false])('accepts a valid tiny gain across TS/Python without accepting another filter (voice=%s)',hasVoice=>{
 const gain=0.000001,filter=masterMixFilter({...mix,voiceGainDb:gain},960000,hasVoice);
 expect(validatePython(filter,gain,hasVoice).status).toBe(0);
 expect(validatePython(filter.replace('volume=0.000001dB','volume=0.1dB'),gain,hasVoice).status).not.toBe(0);
 expect(validatePython(filter+';movie=/tmp/injected',gain,hasVoice).status).not.toBe(0);
});
it.each([true,false])('attenuates the entire music bus before ducking while preserving voice and foley (voice=%s)',hasVoice=>{
 const filter=masterMixFilter(mix,960000,hasVoice,-3);
 expect(filter).toContain('[1:a]aformat=sample_fmts=flt:channel_layouts=stereo,volume=-3dB');
 expect(filter).toContain('[0:a]aresample=48000,aformat=sample_fmts=flt:channel_layouts=stereo,volume=-3dB');
 expect(filter).toContain('[2:a]aformat=sample_fmts=flt:channel_layouts=stereo[foley]');
 const job={schemaVersion:2,planSha256:'a'.repeat(64),samples:960000,hasVoice,musicGainDb:-3,mix,filter,inputSha256:{voice:'b'.repeat(64),music:'c'.repeat(64),foley:'d'.repeat(64)}};
 const check=(value:unknown)=>spawnSync('python3',['-c',"import sys,json;sys.path.insert(0,'runtime/media');import master;master.validate(json.load(sys.stdin))"],{input:JSON.stringify(value),encoding:'utf8'}).status;
 expect(check(job)).toBe(0);
 expect(check({...job,musicGainDb:-2})).not.toBe(0);
 expect(check({...job,filter:filter+';movie=/tmp/injected'})).not.toBe(0);
 for(const gain of [NaN,Infinity,-7,1])expect(()=>masterMixFilter(mix,960000,hasVoice,gain)).toThrow('AUDIO_MIX_INVALID');
});
