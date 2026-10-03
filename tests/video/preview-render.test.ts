import{expect,it}from'vitest';
import{excerptDockerArguments,previewExcerptStageKey,validatePreviewSegments,validatePreviewSpeechCoverage}from'@/services/video/preview/render-excerpt';
import {stagePreviewArtifact} from '@/services/video/preview/artifact';
import {FileStore} from '@/services/video/storage/file-store';
import {ProjectStore} from '@/services/video/storage/project-store';

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
it('binds mono/stereo in the actual excerpt key and preserves the requested stereo channels',()=>{
 const input={fullFilmSha256:'a'.repeat(64),segments,width:1280,height:720,fps:24 as const,runtimeDigest:'b'.repeat(64)};
 const mono=previewExcerptStageKey({...input,audioChannels:1}),stereo=previewExcerptStageKey({...input,audioChannels:2});expect(stereo).not.toBe(mono);
 const args=excerptDockerArguments('sha256:'+'b'.repeat(64),'1000:1000',stereo,'/tmp/full.mp4','/tmp/out',segments,24,2);
 expect(args[args.indexOf('-ac')+1]).toBe('2');
});
it('rejects a rendered envelope claiming stereo while its decoded metadata says mono before touching project storage',async()=>{
 const root='/tmp/vb-channel-envelope',sha='a'.repeat(64),stageKey=previewExcerptStageKey({fullFilmSha256:sha,segments,width:1280,height:720,fps:24,runtimeDigest:sha,audioChannels:2});
 await expect(stagePreviewArtifact(new ProjectStore(new FileStore(root)),root,crypto.randomUUID(),crypto.randomUUID(),crypto.randomUUID(),{stageKey,outputPath:root+'/preview/'+stageKey+'/output/preview.mp4',sha256:sha,bytes:3000,durationMs:9000,sourceFilmSha256:sha,excerptMap:segments,audioChannels:2,technicalQa:{result:'pass',sha256:sha,bytes:3000,width:1280,height:720,durationSec:9,fps:24,frames:216,audio:true,audioChannels:1}})).rejects.toThrow('PREVIEW_ARTIFACT_INVALID');
});
