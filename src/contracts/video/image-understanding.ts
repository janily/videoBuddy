import {createHash} from 'node:crypto';
import {z} from 'zod';
import {guardSourceImageProof,type SourceImageProof} from './source-image';
const mime=z.enum(['image/png','image/jpeg','image/webp']),digest=z.string().regex(/^[a-f0-9]{64}$/),text=z.string().trim().min(1).max(2000);
const RegionSchema=z.strictObject({x:z.number().min(0).max(1),y:z.number().min(0).max(1),width:z.number().positive().max(1),height:z.number().positive().max(1)}).refine(region=>region.x+region.width<=1&&region.y+region.height<=1);
export const ImageUnderstandingInputSchema=z.strictObject({assetId:z.uuid(),mime,sha256:digest,bytes:z.number().int().min(1).max(20*1024*1024),intendedUse:z.string().trim().min(1).max(2000)});
export type ImageUnderstandingInput=z.infer<typeof ImageUnderstandingInputSchema>;
export const ImageUnderstandingSchema=z.strictObject({schemaVersion:z.literal(1),assetId:z.uuid(),sourceSha256:digest,mime,description:text,observations:z.array(z.strictObject({description:text,region:RegionSchema})).max(30),visibleText:z.array(z.strictObject({text,region:RegionSchema,confidence:z.enum(['clear','uncertain'])})).max(50),uncertainties:z.array(text).max(30),scope:z.literal('provided_image_only'),trust:z.literal('untrusted_material')});
export type ImageUnderstanding=z.infer<typeof ImageUnderstandingSchema>;
export function imageUnderstandingInput(raw:unknown,original:Uint8Array):ImageUnderstandingInput{
 const parsed=ImageUnderstandingInputSchema.safeParse(raw);if(!parsed.success)throw Error('IMAGE_INPUT_INVALID');const input=parsed.data;
 const data=Buffer.from(original);if(data.byteLength!==input.bytes||createHash('sha256').update(data).digest('hex')!==input.sha256)throw Error('IMAGE_INPUT_CHANGED');
 const valid=input.mime==='image/png'?data.length>=24&&data.subarray(0,8).toString('hex')==='89504e470d0a1a0a'&&data.toString('ascii',12,16)==='IHDR':input.mime==='image/jpeg'?data.length>=4&&data[0]===255&&data[1]===216&&data[2]===255:data.length>=16&&data.toString('ascii',0,4)==='RIFF'&&data.toString('ascii',8,12)==='WEBP';
 if(!valid)throw Error('IMAGE_INPUT_INVALID');return input;
}
export function guardImageUnderstanding(raw:unknown,input:ImageUnderstandingInput):ImageUnderstanding{
 const parsed=ImageUnderstandingSchema.safeParse(raw);if(!parsed.success||Buffer.byteLength(JSON.stringify(parsed.data))>40000)throw Error('IMAGE_ANALYSIS_INVALID');const result=parsed.data;
 if(result.assetId!==input.assetId||result.sourceSha256!==input.sha256||result.mime!==input.mime)throw Error('IMAGE_ANALYSIS_CHANGED');return result;
}
export function imageAnalysisText(analysis:ImageUnderstanding){return[analysis.description,...analysis.observations.map(o=>'可见：'+o.description),...analysis.visibleText.map(t=>`文字(${t.confidence})：${t.text}`),...analysis.uncertainties.map(t=>'未确认：'+t)].join('\n')}
export const ImageAnalysisRecordSchema=z.strictObject({schemaVersion:z.literal(5),assetId:z.uuid(),mime,sha256:digest,text:z.string().min(1).max(40000),imageAnalysis:ImageUnderstandingSchema,trust:z.literal('untrusted_material')}).refine(record=>record.assetId===record.imageAnalysis.assetId&&record.mime===record.imageAnalysis.mime&&record.sha256===record.imageAnalysis.sourceSha256&&record.text===imageAnalysisText(record.imageAnalysis)&&Buffer.byteLength(record.text)<=40000);

/** Bind the sent normalized PNG to its original source without replacing its identity. */
export function guardImageModelView(input:ImageUnderstandingInput,raw:SourceImageProof,data:Uint8Array){
 const proof=guardSourceImageProof(raw,{projectId:raw.job.projectId,assetId:input.assetId,sourceMime:input.mime,sourceSha256:input.sha256,sourceBytes:input.bytes}),receipt=proof.receipt;
 if(receipt.status!=='pass')throw Error('IMAGE_VIEW_CHANGED');const png=Buffer.from(data);
 if(png.length<24||png.length!==receipt.bytes||createHash('sha256').update(png).digest('hex')!==receipt.sha256||png.subarray(0,8).toString('hex')!=='89504e470d0a1a0a'||png.toString('ascii',12,16)!=='IHDR'||png.readUInt32BE(16)!==receipt.width||png.readUInt32BE(20)!==receipt.height)throw Error('IMAGE_VIEW_CHANGED');
 return{...proof,receipt};
}
