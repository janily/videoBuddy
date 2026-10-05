import {expect,it} from 'vitest';
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';import {tmpdir} from 'node:os';
import {FileStore} from '@/services/video/storage/file-store';
import {readSourceImageView} from '@/services/video/assets/image-preparation';
import {updateJson} from '@/services/video/storage/atomic-store';
it('cold-verifies fixed completed native receipt and actual bytes without writes, configuration or producer retry',async()=>{
 const proof=JSON.parse(await readFile('tests/fixtures/source-image/proof.json','utf8')),root=await mkdtemp(join(tmpdir(),'vb-view-read-')),store=new FileStore(root),input={projectId:proof.job.projectId,assetId:proof.job.assetId,sourceMime:proof.job.sourceMime,sourceSha256:proof.job.sourceSha256,sourceBytes:proof.job.sourceBytes},prefix=`projects/${input.projectId}/operations/${proof.operationId}/media-effects`,journal={store,prefix},stage=join(root,'media',proof.job.jobSha256),original=await readFile('tests/fixtures/source-image/original.jpeg'),data=await readFile('tests/fixtures/source-image/view.png'),key=prefix+'/'+proof.argumentsSha256;
 try{await mkdir(join(stage,'assets'),{recursive:true});await mkdir(join(stage,'output'));await writeFile(join(stage,'assets',input.assetId+'.bin'),original);await writeFile(join(stage,'output/view.png'),data);await store.create(key,{schemaVersion:1,invocation:crypto.randomUUID(),image:'sha256:'+proof.job.runtimeDigest,argsSha256:proof.argumentsSha256,state:'completed',output:JSON.stringify(proof.receipt)});
 const originals=join(root,'assets',input.projectId);await mkdir(originals,{recursive:true});const originalPath=join(originals,input.assetId+'.bin');await writeFile(originalPath,original);
 const keys=await store.listKeys('projects',4);store.create=async()=>{throw Error('UNEXPECTED_WRITE')};let fences=0;const result=await readSourceImageView(root,input,proof,{journal,assertActive:async()=>{fences++}});expect(result.data.equals(data)).toBe(true);expect(fences).toBe(2);expect(await store.listKeys('projects',4)).toEqual(keys);
 const changedOriginal=Buffer.from(original);changedOriginal[changedOriginal.length-1]^=1;await writeFile(originalPath,changedOriginal);await expect(readSourceImageView(root,input,proof,{journal,assertActive:async()=>{}})).rejects.toThrow('IMAGE_INPUT_CHANGED');await writeFile(originalPath,original);
 await writeFile(join(stage,'output/view.png'),Buffer.from('changed'));await expect(readSourceImageView(root,input,proof,{journal,assertActive:async()=>{}})).rejects.toThrow('SOURCE_IMAGE_CHANGED');await writeFile(join(stage,'output/view.png'),data);
 await updateJson(store,key,(record:Record<string,unknown>)=>{const next:Record<string,unknown>={...record,state:'unknown'};delete next.output;return next});await expect(readSourceImageView(root,input,proof,{journal,assertActive:async()=>{}})).rejects.toThrow('MEDIA_STOP_UNKNOWN');expect(await store.listKeys('projects',4)).toEqual(keys);
 }finally{await rm(root,{recursive:true,force:true})}
});
