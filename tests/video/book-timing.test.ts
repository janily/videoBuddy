import {expect,it} from 'vitest';
import {compileSubtitles} from '@/services/video/audio/subtitles';
import {frozenCaptions} from '@/services/video/timeline/package';
import {canonicalHash} from '@/services/video/domain/hash';
import {trustedStyleFont} from '@/services/video/media/font-catalog';
import {bookCaptionRendererSha256,bookCaptionProducerSha256} from '@/services/video/media/book-caption-layer';
import {BookTimingFontSchema,assertBookCaptionGlyphs} from '@/services/video/audio/book-font';
import type {VerifiedNarrationManifest} from '@/services/video/audio/asr';
import type {TimingDraft} from '@/services/video/preview/timing-draft';
import type {TreatmentPlan} from '@/contracts/video/treatment';
it('reserves reveal time in addition to the complete readable and spoken hold',()=>{
 const text='观察成长',manifest={durationMs:20000,lines:[{lineId:'line_1',displayText:text,spokenText:text,startMs:1000,durationMs:2500,voice:{wav:{durationMs:2500,sha256:'a'.repeat(64)}},asrStatus:'pass',wordTimingsStatus:'available',wordTimings:[{text,startMs:0,endMs:2300}]}]} as VerifiedNarrationManifest;
 const plain=compileSubtitles(manifest,24,new Set(text)),book=compileSubtitles(manifest,24,new Set(text),{revealMs:350});
 expect(book[0].endFrame).toBeGreaterThanOrEqual(plain[0].endFrame+8);
 expect(book[0].endMs-1000-350).toBeGreaterThanOrEqual(3100);
 const faces=['mashanzheng','patrickhand'].map(id=>{const f=trustedStyleFont(id);return{id,family:f.family,fontSha256:f.font.sha256,fontBytes:f.font.bytes,licenseSha256:f.licenseFile.sha256,metadataSha256:f.metadata.sha256,charsetSha256:'b'.repeat(64)}}),font=BookTimingFontSchema.parse({family:'Crayon Book Handwriting',runtimeDigest:'a'.repeat(64),charsetSha256:canonicalHash(faces.map(f=>({id:f.id,charsetSha256:f.charsetSha256}))),revealMs:350,rendererSha256:bookCaptionRendererSha256,producerSha256:bookCaptionProducerSha256,faces});
 const timing:TimingDraft={schemaVersion:1,briefVersion:0,styleSlug:'crayon-book',styleRulesHash:'a'.repeat(64),durationMs:20000,totalFrames:480,fps:24,sampleRate:48000,shots:[],narration:[],captions:book,track:{outputPath:'/tmp/unused',sha256:'a'.repeat(64),samples:960000,runtimeDigest:'a'.repeat(64),silence:false},font,qualityStatus:'semantic_not_checked'},treatment={shots:[{factIds:['fact1']}]} as TreatmentPlan;
 expect(frozenCaptions(timing,treatment)[0].stableReadableStartFrame).toBe(book[0].startFrame+9);
 expect(frozenCaptions({...timing,font:null},treatment)[0].stableReadableStartFrame).toBe(book[0].startFrame);
});
it('does not accept a claimed book font without both frozen installed faces',()=>{
 expect(BookTimingFontSchema.safeParse({family:'Crayon Book Handwriting',runtimeDigest:'a'.repeat(64),charsetSha256:'b'.repeat(64)}).success).toBe(false);
});

it('checks glyphs in the face actually selected for mixed Chinese and Latin captions',()=>{
 const faces=new Map([['mashanzheng',new Set('种子。')],['patrickhand',new Set('ABC.')]]);
 expect(()=>assertBookCaptionGlyphs(['种子。','ABC.'],faces)).not.toThrow();
 expect(()=>assertBookCaptionGlyphs(['种子ABC。'],faces)).toThrow('FONT_GLYPH_MISSING');
});
