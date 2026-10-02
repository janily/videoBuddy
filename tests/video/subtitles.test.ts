import {expect,it} from 'vitest';
import {compileSubtitles,formatSrt,parseFontCharset} from '@/services/video/audio/subtitles';
import type {VerifiedNarrationManifest} from '@/services/video/audio/asr';

function line(text:string,startMs:number,durationMs:number){
 return{lineId:`line_${startMs}`,language:'zh-CN',spokenText:text,displayText:text,expectedAsrText:text,startMs,durationMs,reservedMs:6000,voice:{wav:{durationMs,sha256:'a'.repeat(64)}},asrStatus:'pass',wordTimingsStatus:'available',recognizedText:text,wordTimings:[{text,startMs:0,endMs:durationMs-500,probability:0.9}]};
}
it('keeps a Chinese caption through measured speech plus 600 ms and exports frame-aligned SRT',()=>{
 const manifest={durationMs:20000,lines:[line('上海活动10月8日',1000,4100),line('欢迎来到上海',9000,2500)]} as VerifiedNarrationManifest;
 const cues=compileSubtitles(manifest,24,new Set('上海活动10月8日欢迎来到'));
 expect(cues[0]).toMatchObject({startFrame:24,endFrame:137,startMs:1000,endMs:5708});
 expect(cues[0].endMs).toBeGreaterThanOrEqual(1000+4100+600);
 expect(formatSrt(cues)).toContain('00:00:01,000 --> 00:00:05,708\n上海活动10月8日');
 expect(formatSrt(cues)).toContain('00:00:09,000');
});
it('rejects a caption that cannot be read before the next line instead of clipping speech',()=>{
 const manifest={durationMs:20000,lines:[line('上海活动将在十月八日开始请准时到场',1000,4100),line('继续',6000,2000)]} as VerifiedNarrationManifest;
 expect(()=>compileSubtitles(manifest,24,new Set('上海活动将在十月八日开始请准时到场继续'))).toThrow('CAPTION_CONFLICT');
});
it('checks actual glyph coverage and rejects malformed subtitle text',()=>{
 const manifest={durationMs:20000,lines:[line('生僻𠮷',1000,2500)]} as VerifiedNarrationManifest;
 expect(()=>compileSubtitles(manifest,24,new Set('生僻'))).toThrow('FONT_GLYPH_MISSING');
 const injected={durationMs:20000,lines:[line('hello\n\n00:00:00,000 --> 00:00:10,000',1000,2500)]} as VerifiedNarrationManifest;
 expect(()=>compileSubtitles(injected,24,new Set('helo0123456789:,- >'))).toThrow('CAPTION_TEXT_INVALID');
});
it('parses a pinned font charset while preserving supplementary code points',()=>{
 const glyphs=parseFontCharset('20-7e 4e0a 6d77 20bb7');
 expect(glyphs.has('上')).toBe(true);expect(glyphs.has('海')).toBe(true);expect(glyphs.has('𠮷')).toBe(true);
 expect(glyphs.has('僻')).toBe(false);
});
