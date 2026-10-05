import {expect,it} from 'vitest';
import {verifySpokenText} from '@/services/video/audio/asr';
import type {AsrTranscript} from '@/services/video/audio/asr';
function transcript(text:string):AsrTranscript{return{language:'zh-CN',model:'Systran/faster-whisper-medium',runtimeDigest:'a'.repeat(64),voiceSha256:'b'.repeat(64),recognizedText:text,segments:[{text,startMs:0,endMs:3000,words:[{text,startMs:0,endMs:3000,probability:0.9}]}]}}
it('MVP can verify identical tone-bearing Mandarin pronunciation while preserving the raw ASR text',()=>{
 const expected='白纸沿中线轻轻对折。',raw='白紙鹽中線輕輕對折';
 expect(()=>verifySpokenText(expected,expected,transcript(raw))).toThrow('ASR_MISMATCH');
 const result=verifySpokenText(expected,expected,transcript(raw),undefined,'mandarin_pronunciation_v1');
 expect(result).toMatchObject({status:'pass',recognizedText:raw,recognitionPolicy:'mandarin_pronunciation_v1'});
});
it('MVP pronunciation preserves tones, syllable count, dates, English and the immutable expectation',()=>{
 for(const [expected,raw] of [['重庆','重青'],['白纸沿中线轻轻对折','白纸沿中线对折'],['活动十月八日开始','活动10月9日开始'],['轻轻折纸','轻轻着纸'],['试飞','起飞'],['hello world','yellow world']])expect(()=>verifySpokenText(expected,expected,transcript(raw),undefined,'mandarin_pronunciation_v1')).toThrow('ASR_MISMATCH');
 expect(()=>verifySpokenText('重庆','重青',transcript('重青'),undefined,'mandarin_pronunciation_v1')).toThrow('ASR_EXPECTATION_CHANGED');
});
