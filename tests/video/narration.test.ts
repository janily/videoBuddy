import {expect,it} from 'vitest';
import {prepareNarration} from '@/services/video/audio/narration';
import type {VoiceJob,VoiceResult} from '@/services/video/audio/voice';

function generated(job:VoiceJob,durationMs:number):VoiceResult{return{lineId:job.lineId,language:job.language,voice:job.language==='zh-CN'?'zf_001':'af_maple',provider:'kokoro-js',model:'test-model',modelLicense:'Apache-2.0',runtimeDigest:'a'.repeat(64),outputPath:'/tmp/narration.wav',wav:{codec:'pcm_f32le',sampleRate:24000,channels:1,samples:durationMs*24,durationMs,bytes:1000,sha256:'b'.repeat(64),peakDbfs:-10,rmsDbfs:-25}}}
const line={lineId:'one',language:'zh-CN' as const,spokenText:'十月八日开始。',displayText:'10月8日开始',expectedAsrText:'十月八日开始',startMs:1000,reservedMs:4000};
it('uses measured voice duration and preserves the distinct display, spoken and ASR texts',async()=>{
 const result=await prepareNarration({durationMs:20000,lines:[line]},'/tmp',async(_root,job)=>generated(job,3100));
 expect(result.lines[0]).toMatchObject({displayText:'10月8日开始',spokenText:'十月八日开始。',expectedAsrText:'十月八日开始',durationMs:3100,asrStatus:'not_checked',wordTimingsStatus:'not_checked'});
});
it('rejects measured TTS overflow instead of truncating, speeding up or extending the film',async()=>{
 await expect(prepareNarration({durationMs:20000,lines:[line]},'/tmp',async(_root,job)=>generated(job,4100))).rejects.toThrow('DURATION_CONFLICT');
});
it('rejects overlaps before synthesis and represents intentional silence as no voice lines',async()=>{
 let calls=0;
 await expect(prepareNarration({durationMs:20000,lines:[line,{...line,lineId:'two',startMs:2000}]},'/tmp',async(_root,job)=>{calls++;return generated(job,1000)})).rejects.toThrow('NARRATION_PLAN_INVALID');
 expect(calls).toBe(0);
 expect(await prepareNarration({durationMs:20000,lines:[]},'/tmp')).toEqual({durationMs:20000,lines:[]});
});
