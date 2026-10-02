import{it,expect}from'vitest';
import{compileTimeline,quantizeCue,assertAsrExpected,validateCaptions}from'@/services/video/timeline/compile';
it('AT-031/080 narration or recording overflow never truncates or silently extends requested duration',()=>{
 expect(()=>compileTimeline({durationSec:45,fps:24,shots:[{id:'s',startFrame:0,endFrame:1080}],narration:[{lineId:'voice',durationMs:70000,startMs:0}],captions:[]})).toThrow('DURATION_CONFLICT');
});
it('AT-033 quantization derives audio from absolute time, with explicit visual error',()=>{
 expect(quantizeCue(100000,24,'audio')).toEqual({requestedTimeUs:100000,resolvedFrame:2,resolvedSample:4800,quantizationErrorUs:0});
 expect(quantizeCue(1,24,'audio')).toEqual({requestedTimeUs:1,resolvedFrame:0,resolvedSample:0,quantizationErrorUs:-1});
 expect(quantizeCue(100000,24,'frame')).toEqual({requestedTimeUs:100000,resolvedFrame:2,resolvedSample:4000,quantizationErrorUs:-16666.66666666667});
});
it('AT-032 short Chinese subtitle duration and missing glyphs block output',()=>{
 expect(()=>validateCaptions([{text:'中文字幕',startFrame:0,endFrame:12}],24,new Set('中文字幕'))).toThrow('CAPTION_UNREADABLE');
 expect(()=>validateCaptions([{text:'生僻𠮷',startFrame:0,endFrame:100}],24,new Set('生僻'))).toThrow('FONT_GLYPH_MISSING');
});
it('AT-079 expected ASR text cannot be altered to match a mispronunciation',()=>{
 expect(()=>assertAsrExpected('重庆','重青','重青')).toThrow('ASR_EXPECTATION_CHANGED');
 expect(()=>assertAsrExpected('重庆','重庆','重青')).toThrow('ASR_MISMATCH');
});
it('normalizes date numeral notation without hiding a wrong spoken date',()=>{
 expect(()=>assertAsrExpected('上海的活动将在十月八日开始','上海的活动将在十月八日开始','上海的活动将在10月8日开始。')).not.toThrow();
 expect(()=>assertAsrExpected('上海的活动将在十月八日开始','上海的活动将在十月八日开始','上海的活動將在10月8日開始')).not.toThrow();
 expect(()=>assertAsrExpected('上海的活动将在十月八日开始','上海的活动将在十月八日开始','上海的活動將在10月9日開始')).toThrow('ASR_MISMATCH');
 expect(()=>assertAsrExpected('上海的活动将在十月八日开始','上海的活动将在十月八日开始','上海的活动将在10月9日开始。')).toThrow('ASR_MISMATCH');
});
it('half-open shot ranges cover the film without undeclared gaps or overlaps',()=>{
 expect(()=>compileTimeline({durationSec:20,fps:24,shots:[{id:'s',startFrame:1,endFrame:480}],narration:[],captions:[]})).toThrow('TIMELINE_COVERAGE');
 expect(compileTimeline({durationSec:20,fps:24,shots:[{id:'s',startFrame:0,endFrame:480}],narration:[],captions:[]}).totalFrames).toBe(480);
});
