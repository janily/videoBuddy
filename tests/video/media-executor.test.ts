import{it,expect}from'vitest';
import{validateOutputPath,sandboxConfiguration,validateSource}from'@/services/video/media/executor';
it('AT-029 untrusted sandbox receives no credentials and deny-all network policy',()=>{
 const config=sandboxConfiguration({VIDEO_SANDBOX_IMAGE_REF:'video-runtime@sha256:'+'a'.repeat(64),VIDEO_SANDBOX_RUNTIME_DIGEST:'b'.repeat(64),VIDEO_SANDBOX_TIMEOUT_SECONDS:'600'},'operation-one');
 expect(config.networkPolicy).toBe('deny-all');expect(config.env).toEqual({});expect(config.image).toContain('@sha256:');
 expect(()=>sandboxConfiguration({VIDEO_SANDBOX_IMAGE_REF:'latest'},'op')).toThrow('CAPABILITY_UNAVAILABLE');
});
it.each(['/etc/passwd','../control.json','output/../../secret','output/evil\u0000.mp4','output/link.mp4'])('AT-078 rejects unsafe output %s',path=>expect(()=>validateOutputPath({path,symlink:path.endsWith('link.mp4'),hardlinks:1},'output')).toThrow('OUTPUT_INVALID'));
it('valid output still needs independent probing; source cannot certify its own QA',()=>{
 expect(validateOutputPath({path:'output/film.mp4',symlink:false,hardlinks:1},'output')).toBe('output/film.mp4');
 expect(()=>validateSource('window.READY=true;window.render=(t)=>{};fetch("https://example.com")')).toThrow('SOURCE_INVALID');
 expect(()=>validateSource('process.env.MODEL_API_KEY')).toThrow('SOURCE_INVALID');
});
