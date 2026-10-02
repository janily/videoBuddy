import {expect,it} from 'vitest';
import {asrConfiguration,asrDockerArguments,verifyNarration,verifySpokenText} from '@/services/video/audio/asr';
import type {AsrTranscript} from '@/services/video/audio/asr';
import type {NarrationManifest,NarrationPlan} from '@/services/video/audio/narration';
import type {VoiceResult} from '@/services/video/audio/voice';

it('pins an input-blind, offline ASR container without handing it expected text',()=>{
 const digest='a'.repeat(64),config=asrConfiguration({VIDEO_ASR_IMAGE_REF:`sha256:${digest}`,VIDEO_ASR_RUNTIME_DIGEST:digest});
 const args=asrDockerArguments(config,'/tmp/asr/job.json','/tmp/voice/narration.wav');
 expect(args).toContain('--network');expect(args).toContain('none');expect(args).toContain('--read-only');
 expect(args.filter(part=>part.includes('readonly'))).toHaveLength(2);
 expect(args.join(' ')).not.toMatch(/expectedAsrText|MODEL_API_KEY|VERCEL/);
 expect(()=>asrConfiguration({VIDEO_ASR_IMAGE_REF:'videobuddy-asr:latest'})).toThrow('ASR_RUNTIME_UNAVAILABLE');
});
it('does not let a revised expected transcript convert a mispronunciation into a pass',()=>{
 const transcript={language:'zh-CN',model:'Systran/faster-whisper-small',segments:[{text:'重青',startMs:0,endMs:500,words:[{text:'重青',startMs:0,endMs:500,probability:0.9}]}],voiceSha256:'a'.repeat(64),runtimeDigest:'b'.repeat(64),recognizedText:'重青'} as AsrTranscript;
 expect(()=>verifySpokenText('重庆','重青',transcript)).toThrow('ASR_EXPECTATION_CHANGED');
 expect(()=>verifySpokenText('重庆','重庆',transcript)).toThrow('ASR_MISMATCH');
 expect(verifySpokenText('重青','重青',transcript).status).toBe('pass');
});
it('checks the immutable narration plan before recognizing any audio',async()=>{
 const plan:NarrationPlan={durationMs:20000,lines:[{lineId:'a',language:'en',spokenText:'Hello.',displayText:'Hello',expectedAsrText:'Hello',startMs:1000,reservedMs:3000}]};
 const voice={lineId:'a',language:'en',voice:'af_maple',provider:'kokoro-js',model:'test',modelLicense:'Apache-2.0',runtimeDigest:'a'.repeat(64),outputPath:'/tmp/voice.wav',wav:{codec:'pcm_f32le',sampleRate:24000,channels:1,samples:24000,durationMs:1000,bytes:1000,sha256:'b'.repeat(64),peakDbfs:-10,rmsDbfs:-20}} as VoiceResult;
 const manifest:NarrationManifest={durationMs:20000,lines:[{...plan.lines[0],durationMs:1000,voice,asrStatus:'not_checked',wordTimingsStatus:'not_checked'}]};
 let calls=0;const recognize=async()=>{calls++;return{language:'en',model:'Systran/faster-whisper-small',segments:[{text:'Hello.',startMs:0,endMs:500,words:[{text:'Hello.',startMs:0,endMs:500,probability:0.9}]}],voiceSha256:voice.wav.sha256,runtimeDigest:'c'.repeat(64),recognizedText:'Hello.'} as AsrTranscript};
 await expect(verifyNarration(plan,{...manifest,lines:[{...manifest.lines[0],expectedAsrText:'Yellow'}]},'/tmp',recognize)).rejects.toThrow('ASR_EXPECTATION_CHANGED');
 expect(calls).toBe(0);
 const checked=await verifyNarration(plan,manifest,'/tmp',recognize);
 expect(checked.lines[0]).toMatchObject({asrStatus:'pass',wordTimingsStatus:'available',recognizedText:'Hello.',asr:{model:'Systran/faster-whisper-small',runtimeDigest:'c'.repeat(64),voiceSha256:voice.wav.sha256}});
 await expect(verifyNarration(plan,manifest,'/tmp',async()=>({...await recognize(),voiceSha256:'f'.repeat(64)}))).rejects.toThrow('ASR_SOURCE_CHANGED');
 await expect(verifyNarration(plan,manifest,'/tmp',async()=>({...await recognize(),language:'zh-CN'}))).rejects.toThrow('ASR_OUTPUT_INVALID');
});
