import {expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import {sourceImageJob,guardSourceImageProof} from '@/contracts/video/source-image';
const input={projectId:randomUUID(),assetId:randomUUID(),sourceMime:'image/jpeg' as const,sourceSha256:'a'.repeat(64),sourceBytes:100};
const job=sourceImageJob({...input,schemaVersion:1,runtimeDigest:'b'.repeat(64),producerSha256:'c'.repeat(64),maxEdge:2048});
const receipt={schemaVersion:1,status:'pass',jobSha256:job.jobSha256,assetId:input.assetId,sourceSha256:input.sourceSha256,runtimeDigest:job.runtimeDigest,producerSha256:job.producerSha256,sourceMime:input.sourceMime,sourceBytes:100,encodedWidth:3000,encodedHeight:1000,orientedWidth:1000,orientedHeight:3000,width:683,height:2048,mime:'image/png',sha256:'d'.repeat(64),bytes:1000,transform:'full_image_resize',coordinates:'oriented_image_normalized'};
const proof={schemaVersion:1,operationId:randomUUID(),argumentsSha256:'e'.repeat(64),job,receipt};
it('binds decoded model view proof to exact original project, asset, geometry, bytes and journal identity',()=>{
 expect(guardSourceImageProof(proof,input)).toMatchObject({job,receipt});
 for(const patch of [{projectId:randomUUID()},{assetId:randomUUID()},{sourceSha256:'f'.repeat(64)},{sourceMime:'image/png'},{sourceBytes:101}])expect(()=>guardSourceImageProof(proof,{...input,...patch})).toThrow('SOURCE_IMAGE_PROOF_CHANGED');
 expect(()=>guardSourceImageProof({...proof,receipt:{...receipt,width:2048}},input)).toThrow();
 expect(()=>guardSourceImageProof({...proof,receipt:{...receipt,status:'fail',errorCode:'IMAGE_DECODE_FAILED'}},input)).toThrow();
});

it('rejects altered model PNG bytes while retaining original JPEG identity and oriented coordinates',async()=>{
 const {readFile}=await import('node:fs/promises'),{guardImageModelView}=await import('@/contracts/video/image-understanding');
 const proof=JSON.parse(await readFile('tests/fixtures/source-image/proof.json','utf8')),data=await readFile('tests/fixtures/source-image/view.png'),input={assetId:proof.job.assetId,mime:proof.job.sourceMime,sha256:proof.job.sourceSha256,bytes:proof.job.sourceBytes,intendedUse:'参考图片'};
 expect(guardImageModelView(input,proof,data).receipt).toMatchObject({width:683,height:2048,coordinates:'oriented_image_normalized'});
 expect(()=>guardImageModelView(input,proof,Buffer.from('changed'))).toThrow('IMAGE_VIEW_CHANGED');
 expect(()=>guardImageModelView({...input,sha256:'f'.repeat(64)},proof,data)).toThrow('SOURCE_IMAGE_PROOF_CHANGED');
});
