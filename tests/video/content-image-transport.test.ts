import {expect,it} from 'vitest';
import {readFile} from 'node:fs/promises';
import sharp from 'sharp';
import {losslessReviewImage} from '@/mastra/video/review-image';
it('transports the exact decoded RGBA pixels and dimensions without resizing the original PNG',async()=>{
 const source=await readFile('docs/engineering/evidence/native-frame-3.png'),before=Buffer.from(source),encoded=await losslessReviewImage(source);
 expect(encoded.toString('ascii',0,4)).toBe('RIFF');expect(encoded.toString('ascii',8,12)).toBe('WEBP');
 expect(await sharp(encoded).ensureAlpha().raw().toBuffer()).toEqual(await sharp(source).ensureAlpha().raw().toBuffer());expect(source).toEqual(before);
},15000);
it('rejects invalid or oversized source images and observes cancellation before encoding',async()=>{
 await expect(losslessReviewImage(Buffer.from('not png'))).rejects.toThrow('CONTENT_IMAGE_ENCODING_FAILED');
 const source=await readFile('docs/engineering/evidence/native-frame-3.png'),oversized=Buffer.from(source);oversized.writeUInt32BE(100000,16);await expect(losslessReviewImage(oversized)).rejects.toThrow('CONTENT_IMAGE_ENCODING_FAILED');
 await expect(losslessReviewImage(source,async()=>{throw Error('RENDER_FENCED')})).rejects.toThrow('RENDER_FENCED');
});
