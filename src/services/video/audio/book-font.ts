import {z} from 'zod';
import {canonicalHash} from '../domain/hash';
import {trustedStyleFont} from '../media/font-catalog';
import {bookCaptionRendererSha256,clearBookCaptionRendererSha256,bookCaptionProducerSha256} from '../media/book-caption-layer';
import {readPinnedStyleFont} from './style-font';
import type {Environment} from '../config/environment';
import type {DockerJournal} from '../media/docker-journal';
const digest=z.string().regex(/^[a-f0-9]{64}$/);
export const LegacyTimingFontSchema=z.strictObject({family:z.literal('Noto Sans CJK SC'),runtimeDigest:digest,charsetSha256:digest});
const faceFields={family:z.string(),fontSha256:digest,fontBytes:z.number().int().positive(),licenseSha256:digest,metadataSha256:digest,charsetSha256:digest};
function checkFaces(font:{faces:Array<{id:string;family:string;fontSha256:string;fontBytes:number;licenseSha256:string;metadataSha256:string;charsetSha256:string}>;charsetSha256:string},ctx:z.RefinementCtx,ids:string[]){
 for(const [index,actual] of font.faces.entries()){
  const locked=trustedStyleFont(ids[index]);
  if(actual.id!==locked.id||actual.family!==locked.family||actual.fontSha256!==locked.font.sha256||actual.fontBytes!==locked.font.bytes||actual.licenseSha256!==locked.licenseFile.sha256||actual.metadataSha256!==locked.metadata.sha256)ctx.addIssue({code:'custom',message:'Frozen book face differs from resource lock'});
 }
 if(font.charsetSha256!==canonicalHash(font.faces.map(f=>({id:f.id,charsetSha256:f.charsetSha256}))))ctx.addIssue({code:'custom',message:'Book charset identity differs'});
}
export const BookTimingFontSchema=z.strictObject({family:z.literal('Crayon Book Handwriting'),runtimeDigest:digest,charsetSha256:digest,revealMs:z.literal(350),rendererSha256:z.literal(bookCaptionRendererSha256),producerSha256:z.literal(bookCaptionProducerSha256),faces:z.array(z.strictObject({id:z.enum(['mashanzheng','patrickhand']),...faceFields})).length(2)}).superRefine((font,ctx)=>checkFaces(font,ctx,['mashanzheng','patrickhand']));
export const ClearBookTimingFontSchema=z.strictObject({family:z.literal('Crayon Book Clear Handwriting'),runtimeDigest:digest,charsetSha256:digest,revealMs:z.literal(350),rendererSha256:z.literal(clearBookCaptionRendererSha256),producerSha256:z.literal(bookCaptionProducerSha256),faces:z.array(z.strictObject({id:z.enum(['longcang','patrickhand']),...faceFields})).length(2)}).superRefine((font,ctx)=>checkFaces(font,ctx,['longcang','patrickhand']));
export const AnyBookTimingFontSchema=z.union([BookTimingFontSchema,ClearBookTimingFontSchema]);
export type AnyBookTimingFont=z.infer<typeof AnyBookTimingFontSchema>;
export function isBookTimingFont(font:{family:string}|null|undefined):font is AnyBookTimingFont{return font?.family==='Crayon Book Handwriting'||font?.family==='Crayon Book Clear Handwriting'}
export function bookFontVersion(font:AnyBookTimingFont):1|2{return font.family==='Crayon Book Clear Handwriting'?2:1}
export type BookTimingFont=z.infer<typeof BookTimingFontSchema>;
export function bookFaceForText(text:string,version:1|2=1){return /\p{Script=Han}/u.test(text)?(version===2?'longcang':'mashanzheng'):'patrickhand'}
export async function readBookTimingFont(env:Environment,options:{version?:1|2;journal?:DockerJournal;assertActive?:()=>Promise<void>}={}){
 const version=options.version||1,actual=[];for(const id of [version===2?'longcang':'mashanzheng','patrickhand'])actual.push(await readPinnedStyleFont(env,id,options));
 const faces=actual.map(f=>({id:f.id,family:f.family,fontSha256:f.fontSha256,fontBytes:f.fontBytes,licenseSha256:f.licenseSha256,metadataSha256:f.metadataSha256,charsetSha256:f.charsetSha256}));
 const font=AnyBookTimingFontSchema.parse({family:version===2?'Crayon Book Clear Handwriting':'Crayon Book Handwriting',runtimeDigest:actual[0].runtimeDigest,charsetSha256:canonicalHash(faces.map(f=>({id:f.id,charsetSha256:f.charsetSha256}))),revealMs:350,rendererSha256:version===2?clearBookCaptionRendererSha256:bookCaptionRendererSha256,producerSha256:bookCaptionProducerSha256,faces});
 if(actual.some(f=>f.runtimeDigest!==font.runtimeDigest))throw Error('BOOK_FONT_RUNTIME_CHANGED');
 return{font,glyphsById:new Map(actual.map(f=>[f.id,f.glyphs]))};
}
export function assertBookCaptionGlyphs(texts:string[],glyphsById:Map<string,Set<string>>,version:1|2=1){
 for(const text of texts){const glyphs=glyphsById.get(bookFaceForText(text,version));if(!glyphs||[...text].some(char=>!/^\s$/.test(char)&&!glyphs.has(char)))throw Error('FONT_GLYPH_MISSING')}
}
