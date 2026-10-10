import {expect,it} from 'vitest';
import {mkdtemp,mkdir,readFile,writeFile,rm,rename,symlink,unlink} from 'node:fs/promises';
import {join} from 'node:path';import {tmpdir} from 'node:os';
import {FileStore} from '@/services/video/storage/file-store';
import {readSourceImageView} from '@/services/video/assets/image-preparation';
import {canonicalHash} from '@/services/video/domain/hash';
import {updateJson} from '@/services/video/storage/atomic-store';
it('cold-verifies completed local receipt and actual bytes without writes, configuration or producer retry',async()=>{
 const proof=JSON.parse(await readFile('tests/fixtures/source-image/proof.json','utf8')),root=await mkdtemp(join(tmpdir(),'vb-view-read-')),store=new FileStore(root),input={projectId:proof.job.projectId,assetId:proof.job.assetId,sourceMime:proof.job.sourceMime,sourceSha256:proof.job.sourceSha256,sourceBytes:proof.job.sourceBytes},prefix=`projects/${input.projectId}/operations/${proof.operationId}/media-effects`,journal={store,prefix},stage=join(root,'media','image-preparation',proof.job.jobSha256),original=await readFile('tests/fixtures/source-image/original.jpeg'),data=await readFile('tests/fixtures/source-image/view.png'),argumentsSha256=canonicalHash({kind:'source_image',operationId:proof.operationId,input}),key=prefix+'/'+argumentsSha256;proof.argumentsSha256=argumentsSha256;
 try{await mkdir(stage,{recursive:true});await writeFile(join(stage,'view.png'),data);await store.create(key,{schemaVersion:1,kind:'source_image',argumentsSha256,state:'completed',outputKey:proof.job.jobSha256,proof});
 const originals=join(root,'assets',input.projectId);await mkdir(originals,{recursive:true});const originalPath=join(originals,input.assetId+'.bin');await writeFile(originalPath,original);
 const keys=await store.listKeys('projects',4);store.create=async()=>{throw Error('UNEXPECTED_WRITE')};let fences=0;const result=await readSourceImageView(root,input,proof,{journal,assertActive:async()=>{fences++}});expect(result.data.equals(data)).toBe(true);expect(fences).toBe(2);expect(await store.listKeys('projects',4)).toEqual(keys);
 await rename(originals,originals+'-outside');await symlink(originals+'-outside',originals,'dir');await expect(readSourceImageView(root,input,proof,{journal,assertActive:async()=>{}}).then(value=>value.receipt.sha256)).rejects.toThrow('SOURCE_IMAGE_CHANGED');await unlink(originals);await rename(originals+'-outside',originals);
 const changedOriginal=Buffer.from(original);changedOriginal[changedOriginal.length-1]^=1;await writeFile(originalPath,changedOriginal);await expect(readSourceImageView(root,input,proof,{journal,assertActive:async()=>{}})).rejects.toThrow('IMAGE_INPUT_CHANGED');await writeFile(originalPath,original);
 await writeFile(join(stage,'view.png'),Buffer.from('changed'));await expect(readSourceImageView(root,input,proof,{journal,assertActive:async()=>{}})).rejects.toThrow('SOURCE_IMAGE_CHANGED');await writeFile(join(stage,'view.png'),data);
 await updateJson(store,key,(record:Record<string,unknown>)=>{const next:Record<string,unknown>={...record,state:'started'};delete next.proof;return next});await expect(readSourceImageView(root,input,proof,{journal,assertActive:async()=>{}})).rejects.toThrow('MEDIA_STOP_UNKNOWN');expect(await store.listKeys('projects',4)).toEqual(keys);
 }finally{await rm(root,{recursive:true,force:true})}
});
