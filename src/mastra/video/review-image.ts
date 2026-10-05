import sharp from 'sharp';
/** A wire encoding only: identities still refer to the immutable source PNG.
 * Reject any change to decoded RGBA pixels, dimensions or alpha. */
export async function losslessReviewImage(source:Uint8Array,assertActive?:()=>Promise<void>):Promise<Buffer>{
 await assertActive?.();
 const png=Buffer.from(source),width=png.length>=24?png.readUInt32BE(16):0,height=png.length>=24?png.readUInt32BE(20):0;
 if(png.length<33||png.length>8*1024*1024||png.subarray(0,8).toString('hex')!=='89504e470d0a1a0a'||png.toString('ascii',12,16)!=='IHDR'||width<64||height<64||width>3840||height>2160)throw Error('CONTENT_IMAGE_ENCODING_FAILED');
 let output:Buffer;
 try{
  const options={limitInputPixels:3840*2160,failOn:'warning' as const};
  const before=await sharp(png,options).ensureAlpha().raw().timeout({seconds:20}).toBuffer({resolveWithObject:true});
  output=await sharp(png,options).webp({lossless:true,effort:6}).timeout({seconds:20}).toBuffer();
  const after=await sharp(output,options).ensureAlpha().raw().timeout({seconds:20}).toBuffer({resolveWithObject:true});
  if(before.info.width!==width||before.info.height!==height||after.info.width!==width||after.info.height!==height||before.info.channels!==4||after.info.channels!==4||!before.data.equals(after.data))throw Error('CONTENT_IMAGE_ENCODING_FAILED');
 }catch{throw Error('CONTENT_IMAGE_ENCODING_FAILED')}
 await assertActive?.();return output;
}
