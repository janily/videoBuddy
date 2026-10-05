import {expect,it} from 'vitest';
import {bookCaptionStyle} from '@/services/video/media/book-caption-layer';
import {composeDockerArguments,composeStageKey,validateCaptionStyle} from '@/services/video/media/compose';
it('binds the trusted paper renderer and actual font hashes to composition identity',()=>{
 const style=bookCaptionStyle({width:1920,height:1080},{x:100,y:800,width:1720,height:200});
 expect(style.book?.rendererSha256).toBe('74d0e41f99a34f7b2da803427d4ba0a5144237e5a96c798adb1cce377a0a167a');
 expect(style.book?.fonts).toHaveLength(2);
 expect(()=>validateCaptionStyle({...style,book:{...style.book!,rendererSha256:'a'.repeat(64)}})).toThrow('CAPTION_STYLE_INVALID');
 expect(()=>bookCaptionStyle({width:1920,height:1080},{x:100,y:1000,width:1720,height:200})).toThrow('CAPTION_STYLE_INVALID');
 const input={pictureSha256:'a'.repeat(64),trackSha256:'b'.repeat(64),trackSilent:false,srtSha256:'c'.repeat(64),runtimeDigest:'d'.repeat(64),style,spec:{width:1280,height:720,durationSec:20,fps:24 as const,bundleHash:'e'.repeat(64),fence:0}};
 expect(composeStageKey(input)).not.toBe(composeStageKey({...input,style:{fontSize:52,marginV:0,outline:0,primary:'#563c2e',outlineColor:'#563c2e',playResX:1920,playResY:1080}}));
});
it('composes an alpha layer once without double-burning SRT and preserves stereo',()=>{
 const style=bookCaptionStyle({width:1920,height:1080},{x:100,y:800,width:1720,height:200});
 const args=composeDockerArguments('sha256:'+'a'.repeat(64),'1000:1000','b'.repeat(64),'/tmp/picture.mp4','/tmp/master.wav','/tmp/captions.srt','/tmp/output',style,false,2,'/tmp/captions.mov');
 expect(args.join(' ')).toContain('dst=/input/captions.mov,readonly');
 expect(args.join(' ')).not.toContain('subtitles=filename');
 expect(args[args.indexOf('-filter_complex')+1]).toContain('[0:v][2:v]overlay');
 expect(args[args.indexOf('-ac')+1]).toBe('2');
 expect(()=>composeDockerArguments('sha256:'+'a'.repeat(64),'1000:1000','b'.repeat(64),'/tmp/picture.mp4','/tmp/master.wav','/tmp/captions.srt','/tmp/output',style,false)).toThrow('COMPOSITION_INVALID');
});
it('rejects unreadable post-reveal holds before native work',async()=>{
 const {prepareBookCaptionLayer}=await import('@/services/video/media/book-caption-layer');
 const style=bookCaptionStyle({width:1920,height:1080},{x:100,y:800,width:1720,height:200}),spec={width:1280,height:720,durationSec:20,fps:24 as const,bundleHash:'a'.repeat(64),fence:0};
 await expect(prepareBookCaptionLayer('/tmp/book-reading',[{lineId:'line_1',text:'观察成长，耐心照料。',startMs:0,endMs:2000,startFrame:0,endFrame:48,voiceSha256:'b'.repeat(64)}],style,spec,{})).rejects.toThrow('BOOK_CAPTION_READING_CONFLICT');
});
it('binds clear handwriting to a distinct renderer version and rejects mixing its fonts with legacy style',()=>{
 const output={width:1920,height:1080},box={x:100,y:800,width:1720,height:200},old=bookCaptionStyle(output,box),clear=bookCaptionStyle(output,box,2);
 expect(clear.book?.schemaVersion).toBe(2);expect(clear.book?.fonts.map(f=>f.id)).toEqual(['longcang','patrickhand']);expect(clear.book?.rendererSha256).not.toBe(old.book?.rendererSha256);
 expect(()=>validateCaptionStyle(clear)).not.toThrow();
 for(const book of [{...clear.book!,schemaVersion:1 as const},{...clear.book!,fonts:old.book!.fonts},{...clear.book!,rendererSha256:old.book!.rendererSha256}])expect(()=>validateCaptionStyle({...clear,book})).toThrow('CAPTION_STYLE_INVALID');
 expect(bookCaptionStyle(output,box)).toEqual(old);
});
