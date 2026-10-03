import {createHash} from 'node:crypto';
import {mkdtemp,mkdir,realpath,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {expect,it,vi} from 'vitest';
const execute=vi.hoisted(()=>vi.fn(async()=>{throw Error('DOCKER_STARTED_UNEXPECTED')}));
vi.mock('@/services/video/media/owned-docker',()=>({runOwnedDocker:execute}));
import {extractVisualFrames} from '@/services/video/quality/visual-evidence';
it('refuses absent frame evidence during read-only replay without starting extraction',async()=>{
 const temporary=await mkdtemp(join(tmpdir(),'vb-visual-readonly-')),root=await realpath(temporary);try{
  const output=join(root,'composition','a'.repeat(64),'output');await mkdir(output,{recursive:true});const outputPath=join(output,'final.mp4'),bytes=Buffer.alloc(2000);await writeFile(outputPath,bytes);await mkdir(join(root,'visual-evidence'));
  await expect(extractVisualFrames(root,{outputPath,sha256:createHash('sha256').update(bytes).digest('hex'),width:1920,height:1080,totalFrames:480},[0,24],'sha256:'+'b'.repeat(64),{mustExist:true})).rejects.toThrow('VISUAL_EVIDENCE_MISSING');
  expect(execute).not.toHaveBeenCalled();
 }finally{await rm(root,{recursive:true,force:true})}
});
