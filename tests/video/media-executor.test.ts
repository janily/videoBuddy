import {it,expect} from 'vitest';
import {mkdtemp,mkdir,rm,writeFile,symlink,link} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {validateSource} from '@/services/video/media/local/source';
import {fileIdentity} from '@/services/video/media/local/files';
import {validateRenderJob,requireRuntimePath} from '@/services/video/media/local/renderer';
import {computeStageKey} from '@/services/video/media/runtime';
import {readVideoCache,videoManifest} from '@/services/video/media/local/cache';
import {canonicalHash} from '@/services/video/domain/hash';
import {encoderPolicy} from '@/services/video/media/local/arguments';
import type {RuntimeVersion} from '@/services/video/media/runtime-version';

it.each(['/etc/passwd','../control.json','/safe/output/../../secret'])('AT-078 rejects output outside the runtime: %s',path=>expect(()=>requireRuntimePath('/safe/output',path)).toThrow('MEDIA_PATH_INVALID'));
it('checks actual files, rejecting symbolic and hard links instead of trusting claimed metadata',async()=>{
 const root=await mkdtemp(join(tmpdir(),'vb-file-'));
 try{const path=join(root,'clip.mp4');await writeFile(path,'verified bytes');const identity=await fileIdentity(path);expect(identity.bytes).toBe(14);await symlink(path,join(root,'link.mp4'));await expect(fileIdentity(join(root,'link.mp4'))).rejects.toThrow('MEDIA_PATH_INVALID');await link(path,join(root,'hard.mp4'));await expect(fileIdentity(path)).rejects.toThrow('MEDIA_FILE_INVALID')}
 finally{await rm(root,{recursive:true,force:true})}
});
it('source cannot access networking or certify its own QA',()=>{
 expect(()=>validateSource('window.READY=true;window.render=()=>{};fetch("https://example.com")')).toThrow('SOURCE_INVALID');
 expect(()=>validateSource('process.env.MODEL_API_KEY')).toThrow('SOURCE_INVALID');
});
it('rejects oversized frame dimensions before starting a renderer',()=>{
 const input={projectId:randomUUID(),operationId:randomUUID(),attemptId:randomUUID(),bundleHash:'b'.repeat(64),runtimeDigest:'c'.repeat(64),sourceHtml:'<script>window.READY=true;window.render=()=>{}</script>',logicalWidth:100000,logicalHeight:180,outputWidth:320,outputHeight:180,fps:24 as const,startFrame:0,endFrame:24,seed:1,fence:1};
 expect(()=>validateRenderJob({...input,stageKey:computeStageKey(input)},input.runtimeDigest)).toThrow('RENDER_JOB_INVALID');
});
it('stage key commits the source and render parameters',()=>{
 const base={projectId:'p',bundleHash:'b'.repeat(64),runtimeDigest:'c'.repeat(64),sourceHtml:'<script>window.READY=true;window.render=()=>{}</script>',logicalWidth:320,logicalHeight:180,outputWidth:320,outputHeight:180,fps:24 as const,startFrame:0,endFrame:24,seed:1,fence:1};
 expect(computeStageKey(base)).toMatch(/^[a-f0-9]{64}$/);expect(computeStageKey({...base,sourceHtml:base.sourceHtml+' '})).not.toBe(computeStageKey(base));expect(computeStageKey({...base,fence:2})).not.toBe(computeStageKey(base));
});
it('cold recovery rejects incomplete publication, altered bytes and a mismatched runtime',async()=>{
 const root=await mkdtemp(join(tmpdir(),'vb-cache-')),key='a'.repeat(64),stage=join(root,key);
 const version:RuntimeVersion={schemaVersion:1,playwright:'test',chromium:'test',ffmpeg:'test',fonts:'b'.repeat(64),renderer:'c'.repeat(64),encoder:{...encoderPolicy,frameFormat:'png'},platform:'linux',architecture:'x64',cpu:'fixture',sandbox:true},digest=canonicalHash(version),inputHash='d'.repeat(64);
 try{
  expect(await readVideoCache(stage,key,digest,inputHash)).toBeNull();await mkdir(stage);await writeFile(join(stage,'final.mp4'),'complete-media');await expect(readVideoCache(stage,key,digest,inputHash)).rejects.toThrow('MEDIA_CACHE_INVALID');
  const result={...await fileIdentity(join(stage,'final.mp4')),key,kind:'final' as const,runtimeDigest:digest,outputPath:join(stage,'final.mp4'),manifestPath:join(stage,'manifest.json'),width:320,height:180,durationSec:1,fps:24,frameCount:24,audio:true,videoCodec:'h264',pixelFormat:'yuv420p',colorSpace:'bt709',tags:{}};
  await writeFile(result.manifestPath,JSON.stringify(videoManifest(key,version,result,inputHash)));expect(await readVideoCache(stage,key,digest,inputHash)).toEqual(result);
  await expect(readVideoCache(stage,key,'f'.repeat(64),inputHash)).rejects.toThrow('MEDIA_CACHE_INVALID');
  await writeFile(result.outputPath,'corrupt-media');await expect(readVideoCache(stage,key,digest,inputHash)).rejects.toThrow('MEDIA_HASH_MISMATCH');
 }finally{await rm(root,{recursive:true,force:true})}
});
