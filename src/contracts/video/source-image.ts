import {z} from 'zod';
import {canonicalHash} from '@/services/video/domain/hash';
const digest=z.string().regex(/^[a-f0-9]{64}$/),size=z.number().int().positive().max(20*1024*1024),dimension=z.number().int().positive().max(65536);
const Input=z.strictObject({schemaVersion:z.literal(1),projectId:z.uuid(),assetId:z.uuid(),sourceMime:z.enum(['image/png','image/jpeg','image/webp']),sourceSha256:digest,sourceBytes:size,runtimeDigest:digest,producerSha256:digest,maxEdge:z.literal(2048)});
export const SourceImageJobSchema=Input.extend({jobSha256:digest});
export type SourceImageJob=z.infer<typeof SourceImageJobSchema>;
export function sourceImageJob(raw:unknown):SourceImageJob{const parsed=Input.safeParse(raw);if(!parsed.success)throw Error('SOURCE_IMAGE_INPUT_INVALID');return{...parsed.data,jobSha256:canonicalHash(parsed.data)}}
const common={schemaVersion:z.literal(1),jobSha256:digest,assetId:z.uuid(),sourceSha256:digest,runtimeDigest:digest,producerSha256:digest};
export const SourceImageReceiptSchema=z.discriminatedUnion('status',[
 z.strictObject({...common,status:z.literal('pass'),sourceMime:Input.shape.sourceMime,sourceBytes:size,encodedWidth:dimension,encodedHeight:dimension,orientedWidth:dimension,orientedHeight:dimension,width:dimension,height:dimension,mime:z.literal('image/png'),sha256:digest,bytes:size,transform:z.literal('full_image_resize'),coordinates:z.literal('oriented_image_normalized')}),
 z.strictObject({...common,status:z.literal('fail'),errorCode:z.enum(['IMAGE_INPUT_INVALID','IMAGE_INPUT_CHANGED','IMAGE_PIXEL_LIMIT','IMAGE_DECODE_FAILED','IMAGE_ANIMATION_UNSUPPORTED','IMAGE_RUNTIME_ERROR'])}),
]);
export type SourceImageReceipt=z.infer<typeof SourceImageReceiptSchema>;
export function guardSourceImageReceipt(raw:unknown,rawJob:SourceImageJob):SourceImageReceipt{
 const {jobSha256,...input}=SourceImageJobSchema.parse(rawJob),job=sourceImageJob(input),parsed=SourceImageReceiptSchema.safeParse(raw);
 if(!parsed.success||job.jobSha256!==jobSha256)throw Error('SOURCE_IMAGE_RECEIPT_INVALID');const receipt=parsed.data;
 for(const field of ['jobSha256','assetId','sourceSha256','runtimeDigest','producerSha256'] as const)if(receipt[field]!==job[field])throw Error('SOURCE_IMAGE_RECEIPT_INVALID');
 if(receipt.status==='pass'){
  const {encodedWidth:ew,encodedHeight:eh,orientedWidth:ow,orientedHeight:oh}=receipt,scale=Math.min(1,job.maxEdge/Math.max(ow,oh));
  if(receipt.sourceMime!==job.sourceMime||receipt.sourceBytes!==job.sourceBytes||ew*eh>30_000_000||!((ow===ew&&oh===eh)||(ow===eh&&oh===ew))||receipt.width!==Math.max(1,Math.round(ow*scale))||receipt.height!==Math.max(1,Math.round(oh*scale)))throw Error('SOURCE_IMAGE_RECEIPT_INVALID');
 }
 return receipt;
}

export const SourceImageProofSchema=z.strictObject({schemaVersion:z.literal(1),operationId:z.uuid(),argumentsSha256:digest,job:SourceImageJobSchema,receipt:SourceImageReceiptSchema}).refine(proof=>proof.receipt.status==='pass');
export type SourceImageProof=z.infer<typeof SourceImageProofSchema>;
export function guardSourceImageProof(raw:unknown,input:{projectId:string;assetId:string;sourceMime:string;sourceSha256:string;sourceBytes:number}):SourceImageProof{
 const parsed=SourceImageProofSchema.safeParse(raw);if(!parsed.success)throw Error('SOURCE_IMAGE_PROOF_CHANGED');const proof=parsed.data;
 for(const field of ['projectId','assetId','sourceMime','sourceSha256','sourceBytes'] as const)if(proof.job[field]!==input[field])throw Error('SOURCE_IMAGE_PROOF_CHANGED');
 guardSourceImageReceipt(proof.receipt,proof.job);return proof;
}
