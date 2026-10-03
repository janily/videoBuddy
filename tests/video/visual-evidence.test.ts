import {it,expect} from 'vitest';
import {visualSamplePlan,frameExtractionArguments} from '@/services/video/quality/visual-evidence';
import {extractVisualFrames} from '@/services/video/quality/visual-evidence';
import {mkdtemp,realpath,rm,mkdir,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {canonicalHash} from '@/services/video/domain/hash';
it('samples every second, shot endpoints and declared critical actions every 0.2s, without assuming sampled images cover audio',()=>{
 const clock={fps:24,totalFrames:480,shots:[{id:'one',startFrame:0,endFrame:240},{id:'two',startFrame:240,endFrame:480}],actions:[{startFrame:48,endFrame:96}]};
 const plan=visualSamplePlan(clock,1),second=visualSamplePlan(clock,2);
 expect(plan).toContain(0);expect(plan).toContain(239);expect(plan).toContain(240);expect(plan).toContain(479);
 expect(plan).toContain(48);expect(plan).toContain(53);expect(plan).toContain(95);expect(second).toContain(12);
 expect(new Set(plan).size).toBe(plan.length);expect(plan).toEqual([...plan].sort((a,b)=>a-b));
 expect(()=>visualSamplePlan({...clock,actions:[{startFrame:1,endFrame:481}]},1)).toThrow('VISUAL_SAMPLE_INVALID');
});
it('rejects a self-signed cache that assigns another decoded PNG to a different movie frame',async()=>{
 const temporary=await mkdtemp(join(tmpdir(),'vb-wrong-frame-')),root=await realpath(temporary);
 try{
  const digest=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex'),movie=Buffer.alloc(2000,1),filmSha256=digest(movie),runtimeDigest='a'.repeat(64),png=await readFile('docs/engineering/evidence/native-frame-3.png');
  const stageKey=canonicalHash({extractor:'ffmpeg-select-v2',filmSha256,runtimeDigest,width:1280,height:720,frames:[60]}),output=join(root,'composition','b'.repeat(64),'output'),directory=join(root,'visual-evidence',stageKey);
  await mkdir(output,{recursive:true});await mkdir(directory,{recursive:true});await writeFile(join(output,'final.mp4'),movie);await writeFile(join(directory,'frame-0001.png'),png);
  await writeFile(join(directory,'manifest.json'),JSON.stringify({schemaVersion:2,extractor:'ffmpeg-select-v2',stageKey,filmSha256,runtimeDigest,width:1280,height:720,frames:[{id:'frame-60',frame:60,sha256:digest(png),bytes:png.length,filename:'frame-0001.png'}]}));
  await expect(extractVisualFrames(root,{outputPath:join(output,'final.mp4'),sha256:filmSha256,width:1280,height:720,totalFrames:480},[60],'sha256:'+runtimeDigest)).rejects.toThrow('VISUAL_EVIDENCE_RECEIPT_MISSING');
 }finally{await rm(root,{recursive:true,force:true})}
});
it('only decodes fixed numeric frames in a pinned non-network container with a read-only movie and private output',()=>{
 const args=frameExtractionArguments('/private/film.mp4','/private/output','sha256:'+'a'.repeat(64),[0,12,479]);
 expect(args).toContain('none');expect(args).toContain('--read-only');expect(args).toContain('type=bind,src=/private/film.mp4,dst=/input/film.mp4,readonly');
 expect(args).toContain('select=eq(n\\,0)+eq(n\\,12)+eq(n\\,479)');
 for(const frames of [[1,1],[-1],[0.5],Array.from({length:25},(_,i)=>i)])expect(()=>frameExtractionArguments('/private/film.mp4','/private/output','sha256:'+'a'.repeat(64),frames)).toThrow('VISUAL_SAMPLE_INVALID');
 expect(()=>frameExtractionArguments('/private/film,extra.mp4','/private/output','latest',[0])).toThrow('VISUAL_SAMPLE_INVALID');
});
