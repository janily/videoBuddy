import {expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import {sourceImageJob,guardSourceImageReceipt} from '@/contracts/video/source-image';
const input={schemaVersion:1 as const,projectId:randomUUID(),assetId:randomUUID(),sourceMime:'image/png' as const,sourceSha256:'a'.repeat(64),sourceBytes:100,runtimeDigest:'b'.repeat(64),producerSha256:'c'.repeat(64),maxEdge:2048 as const};
const job=()=>sourceImageJob(input),receipt=()=>({schemaVersion:1,status:'pass',jobSha256:job().jobSha256,assetId:input.assetId,sourceMime:input.sourceMime,sourceSha256:input.sourceSha256,sourceBytes:input.sourceBytes,runtimeDigest:input.runtimeDigest,producerSha256:input.producerSha256,encodedWidth:4000,encodedHeight:2000,orientedWidth:4000,orientedHeight:2000,width:2048,height:1024,mime:'image/png',sha256:'d'.repeat(64),bytes:1000,transform:'full_image_resize',coordinates:'oriented_image_normalized'});
it('binds decoded view to original, actual producer and full-image aspect without claiming semantic QA',()=>{
 expect(guardSourceImageReceipt(receipt(),job())).toMatchObject({width:2048,height:1024,status:'pass'});
 for(const patch of [{sourceSha256:'e'.repeat(64)},{jobSha256:'e'.repeat(64)},{assetId:randomUUID()},{runtimeDigest:'e'.repeat(64)},{producerSha256:'e'.repeat(64)},{width:1024},{orientedWidth:2000,orientedHeight:2000},{mime:'image/jpeg'},{semanticQualityPassed:true}])expect(()=>guardSourceImageReceipt({...receipt(),...patch},job())).toThrow('SOURCE_IMAGE_RECEIPT_INVALID');
 expect(()=>sourceImageJob({...input,sourceBytes:20*1024*1024+1})).toThrow('SOURCE_IMAGE_INPUT_INVALID');
});
it('supports native EXIF rotation geometry, forbids cropping/upscaling and preserves exact failure identity',()=>{
 expect(guardSourceImageReceipt({...receipt(),orientedWidth:2000,orientedHeight:4000,width:1024,height:2048},job())).toMatchObject({height:2048});
 const failure={schemaVersion:1,status:'fail',jobSha256:job().jobSha256,assetId:input.assetId,sourceSha256:input.sourceSha256,runtimeDigest:input.runtimeDigest,producerSha256:input.producerSha256,errorCode:'IMAGE_DECODE_FAILED'};
 expect(guardSourceImageReceipt(failure,job())).toEqual(failure);
 expect(()=>guardSourceImageReceipt({...failure,jobSha256:'f'.repeat(64)},job())).toThrow('SOURCE_IMAGE_RECEIPT_INVALID');
 expect(()=>guardSourceImageReceipt({...receipt(),encodedWidth:100,encodedHeight:50,orientedWidth:100,orientedHeight:50,width:2048,height:1024},job())).toThrow('SOURCE_IMAGE_RECEIPT_INVALID');
});

it('enforces the specified 30 megapixel source limit even for a correctly resized view',()=>{
 expect(()=>guardSourceImageReceipt({...receipt(),encodedWidth:10000,encodedHeight:4000,orientedWidth:10000,orientedHeight:4000,width:2048,height:819},job())).toThrow('SOURCE_IMAGE_RECEIPT_INVALID');
});
