import {expect,it} from 'vitest';
import {mkdtemp,readFile,rm,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {persistArchiveObject} from '@/services/video/exports/archive-object';
import {actualArtifactSha256} from '@/services/video/exports/verified-file';
import {encodeSubtitles} from '@/services/video/exports/documents';
it('T14 SRT preserves full-film frame times, ordering, Unicode and line breaks',()=>{
 expect(encodeSubtitles({fps:24,totalFrames:240,captions:[{text:'第二行\n活动开始',startFrame:25,endFrame:48},{text:'上海，青禾',startFrame:0,endFrame:24}]})).toBe('1\r\n00:00:00,000 --> 00:00:01,000\r\n上海，青禾\r\n\r\n2\r\n00:00:01,041 --> 00:00:02,000\r\n第二行\r\n活动开始\r\n\r\n');
});
it('T14 SRT refuses absent captions and unsafe content or timing instead of inventing captions',()=>{
 expect(()=>encodeSubtitles({fps:24,totalFrames:240,captions:[]})).toThrow('EXPORT_NOT_APPLICABLE');
 for(const c of [{text:'hello\n\nforged block',startFrame:0,endFrame:24},{text:'hello\u0000',startFrame:0,endFrame:24},{text:'00:00:00,000 --> 00:00:30,000',startFrame:0,endFrame:24},{text:'hello',startFrame:24,endFrame:0},{text:'hello',startFrame:0,endFrame:241},{text:'hello',startFrame:0.1,endFrame:24}])expect(()=>encodeSubtitles({fps:24,totalFrames:240,captions:[c]})).toThrow('EXPORT_DOCUMENT_INVALID');
});
it('T14 SRT private bytes retain full-frame timestamps, replay identically and reject replacement',async()=>{
 const root=await mkdtemp(join(tmpdir(),'vb-srt-export-'));
 try{
  const bytes=Buffer.from(encodeSubtitles({fps:60,totalFrames:7200,captions:[{text:'青禾\n完整字幕',startFrame:3601,endFrame:7199}]})),sha=createHash('sha256').update(bytes).digest('hex'),key=`projects/${randomUUID()}/artifacts/${randomUUID()}/files/captions.srt`;
  await persistArchiveObject(root,key,sha,bytes);await persistArchiveObject(root,key,sha,bytes);
  expect(await readFile(join(root,'objects',key))).toEqual(bytes);
  expect(bytes.toString()).toContain('00:01:00,016 --> 00:01:59,984');
  expect(await actualArtifactSha256(root,key,bytes.length)).toBe(sha);
  const info=await stat(join(root,'objects',key));expect(info.mode&0o777).toBe(0o600);expect(info.nlink).toBe(1);
  const other=Buffer.from('different subtitle bytes');await expect(persistArchiveObject(root,key,createHash('sha256').update(other).digest('hex'),other)).rejects.toThrow('ARTIFACT_INVALID');
  expect(await readFile(join(root,'objects',key))).toEqual(bytes);
 }finally{await rm(root,{recursive:true,force:true})}
});
