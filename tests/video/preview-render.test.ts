import{expect,it}from'vitest';
import{excerptDockerArguments,previewExcerptStageKey,validatePreviewSegments,validatePreviewSpeechCoverage}from'@/services/video/preview/render-excerpt';

const segments=[
 {previewStartMs:0,previewEndMs:3000,sourceStartMs:0,sourceEndMs:3000,shotId:'opening'},
 {previewStartMs:3000,previewEndMs:6000,sourceStartMs:7000,sourceEndMs:10000,shotId:'middle'},
 {previewStartMs:6000,previewEndMs:9000,sourceStartMs:15000,sourceEndMs:18000,shotId:'ending'},
];
it('T11 locks three 24fps source ranges to nine seconds of true A/V excerpt',()=>{
 expect(validatePreviewSegments(segments,20000,24)).toMatchObject({durationMs:9000,totalFrames:216});
 const key=previewExcerptStageKey({fullFilmSha256:'a'.repeat(64),segments,width:720,height:406,fps:24,runtimeDigest:'b'.repeat(64)});
 expect(key).toMatch(/^[a-f0-9]{64}$/);
 expect(previewExcerptStageKey({fullFilmSha256:'c'.repeat(64),segments,width:720,height:406,fps:24,runtimeDigest:'b'.repeat(64)})).not.toBe(key);
 const args=excerptDockerArguments('sha256:'+'b'.repeat(64),'1000:1000',key,'/tmp/full.mp4','/tmp/out',segments,24);
 expect(args.join(' ')).toContain('concat=n=3:v=1:a=1');
 expect(args.join(' ')).toContain('trim=start_frame=168:end_frame=240');
 expect(args.join(' ')).toContain('atrim=start_sample=336000:end_sample=480000');
 expect(args).toContain('--network');expect(args).toContain('none');expect(args.join(' ')).toContain('readonly');
});
it('T11 rejects unmapped transitions, nonframe cuts, and a too-short excerpt',()=>{
 expect(()=>validatePreviewSegments([{...segments[0],sourceStartMs:null,sourceEndMs:null,shotId:null},...segments.slice(1)],20000,24)).toThrow('EXCERPT_UNRENDERABLE');
 expect(()=>validatePreviewSegments([{...segments[0],sourceStartMs:101,sourceEndMs:3101},...segments.slice(1)],20000,24)).toThrow('EXCERPT_UNRENDERABLE');
 expect(()=>validatePreviewSegments(segments.slice(0,1),20000,24)).toThrow('EXCERPT_INVALID');
});
it('T11 refuses an excerpt that cuts across an actual narration line',()=>{
 expect(()=>validatePreviewSpeechCoverage(segments,[{startMs:1000,endMs:4100}],20000)).toThrow('EXCERPT_SPEECH_CUT');
 expect(()=>validatePreviewSpeechCoverage(segments,[{startMs:1000,endMs:2500},{startMs:7000,endMs:9500}],20000)).not.toThrow();
 expect(()=>validatePreviewSpeechCoverage(segments,[{startMs:1000,endMs:21000}],20000)).toThrow('EXCERPT_SPEECH_INVALID');
});
