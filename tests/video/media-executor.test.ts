import{it,expect}from'vitest';
import{mkdtemp,mkdir,readFile,rm,writeFile}from'node:fs/promises';
import{tmpdir}from'node:os';
import{join}from'node:path';
import{validateOutputPath,validateSource}from'@/services/video/media/executor';
it.each(['/etc/passwd','../control.json','output/../../secret','output/evil\u0000.mp4','output/link.mp4'])('AT-078 rejects unsafe output %s',path=>expect(()=>validateOutputPath({path,symlink:path.endsWith('link.mp4'),hardlinks:1},'output')).toThrow('OUTPUT_INVALID'));
it('valid output still needs independent probing; source cannot certify its own QA',()=>{
 expect(validateOutputPath({path:'output/film.mp4',symlink:false,hardlinks:1},'output')).toBe('output/film.mp4');
 expect(()=>validateSource('window.READY=true;window.render=(t)=>{};fetch("https://example.com")')).toThrow('SOURCE_INVALID');
 expect(()=>validateSource('process.env.MODEL_API_KEY')).toThrow('SOURCE_INVALID');
});
it('self-hosted Docker render uses a pinned image, no network, no secrets, and bounded resources',async()=>{
 const {dockerConfiguration,dockerArguments}=await import('@/services/video/media/docker-executor');
 const config=dockerConfiguration({VIDEO_MEDIA_IMAGE_REF:'sha256:'+'a'.repeat(64),VIDEO_MEDIA_RUNTIME_DIGEST:'a'.repeat(64),VIDEO_MEDIA_TIMEOUT_SECONDS:'600'},'operation-one');
 const args=dockerArguments(config,'/persistent/stage','c'.repeat(64));
 expect(args).toContain('--network');expect(args).toContain('none');expect(args).toContain('--read-only');expect(args).toContain('--cap-drop');expect(args).toContain('ALL');expect(args).toContain('--pids-limit');
 expect(args).toContain('VIDEO_RENDER_TIMEOUT_SECONDS=600');expect(args.filter(value=>value.includes('readonly'))).toHaveLength(2);
 expect(args.join(' ')).not.toContain(',rw');
 expect(args.join(' ')).not.toMatch(/MODEL_API_KEY|VERCEL|BLOB_READ_WRITE_TOKEN/);
 expect(()=>dockerConfiguration({VIDEO_MEDIA_IMAGE_REF:'latest'},'op')).toThrow('CAPABILITY_UNAVAILABLE');
 expect(()=>dockerConfiguration({VIDEO_MEDIA_IMAGE_REF:'sha256:'+'a'.repeat(64),VIDEO_MEDIA_RUNTIME_DIGEST:'b'.repeat(64),VIDEO_MEDIA_TIMEOUT_SECONDS:'600'},'op')).toThrow('CAPABILITY_UNAVAILABLE');
});
it('rejects oversized frame dimensions before starting Docker',async()=>{
 const {DockerExecutor}=await import('@/services/video/media/docker-executor');
 const sourceHtml='<script>window.READY=true;window.render=()=>{}</script>';
 await expect(new DockerExecutor('/tmp').submit({projectId:'p',operationId:'o',attemptId:'a',stageKey:'a'.repeat(64),bundleHash:'b'.repeat(64),runtimeDigest:'c'.repeat(64),sourceHtml,logicalWidth:100000,logicalHeight:180,outputWidth:320,outputHeight:180,fps:24,startFrame:0,endFrame:24,seed:1,fence:1})).rejects.toThrow('RENDER_JOB_INVALID');
});
it('stage key commits the source and render parameters',async()=>{
 const {computeStageKey}=await import('@/services/video/media/docker-executor');
 const base={projectId:'p',bundleHash:'b'.repeat(64),runtimeDigest:'c'.repeat(64),sourceHtml:'<script>window.READY=true;window.render=()=>{}</script>',logicalWidth:320,logicalHeight:180,outputWidth:320,outputHeight:180,fps:24 as const,startFrame:0,endFrame:24,seed:1,fence:1};
 expect(computeStageKey(base)).toMatch(/^[a-f0-9]{64}$/);
 expect(computeStageKey({...base,sourceHtml:base.sourceHtml+' '})).not.toBe(computeStageKey(base));
 expect(computeStageKey({...base,fence:2})).not.toBe(computeStageKey(base));
});
it('recovers a crash after the scene file was written but before the job commit',async()=>{
 const {writeStageInputs}=await import('@/services/video/media/docker-executor');
 const root=await mkdtemp(join(tmpdir(),'vb-stage-')),stage=join(root,'stage');
 try{await mkdir(stage);await writeFile(join(stage,'scene.html'),'source');
  await writeStageInputs(stage,'source','{"job":1}');
  expect(await readFile(join(stage,'job.json'),'utf8')).toBe('{"job":1}');
  await expect(writeStageInputs(stage,'changed','{"job":1}')).rejects.toThrow('STAGE_UNKNOWN');
 }finally{await rm(root,{recursive:true,force:true})}
});
