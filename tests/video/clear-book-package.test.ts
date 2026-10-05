import {expect,it} from 'vitest';
import {expectedCaptionPackage,CaptionPackageSchema} from '@/contracts/video/film-package';
import {trustedStyleFont} from '@/services/video/media/font-catalog';
import {canonicalHash} from '@/services/video/domain/hash';
import {bookCaptionProducerSha256,clearBookCaptionRendererSha256} from '@/services/video/media/book-caption-layer';
import {AnyBookTimingFontSchema,assertBookCaptionGlyphs} from '@/services/video/audio/book-font';
import {readBookFontReceipt} from '@/services/video/audio/book-font-receipt';
import {bookCaptionRendererSha256} from '@/services/video/media/book-caption-layer';
import {TimingDraftSchema} from '@/services/video/preview/timing-draft';
import {FileStore} from '@/services/video/storage/file-store';
import {recordBookFontReceipt,frozenBookFontHashes,bookFontReceiptKey} from '@/services/video/audio/book-font-receipt';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const faces=['longcang','patrickhand'].map(id=>{const f=trustedStyleFont(id);return{id,family:f.family,fontSha256:f.font.sha256,fontBytes:f.font.bytes,licenseSha256:f.licenseFile.sha256,metadataSha256:f.metadata.sha256,charsetSha256:'b'.repeat(64)}});
const font={family:'Crayon Book Clear Handwriting',runtimeDigest:'a'.repeat(64),charsetSha256:canonicalHash(faces.map(f=>({id:f.id,charsetSha256:f.charsetSha256}))),revealMs:350,rendererSha256:clearBookCaptionRendererSha256,producerSha256:bookCaptionProducerSha256,faces};
it('freezes clear handwriting only in package 4 and rejects crossed font or renderer versions',()=>{
 const parsed=TimingDraftSchema.shape.font.parse(font),pkg=expectedCaptionPackage(parsed,{width:1920,height:1080},'v5.1-package-4-clear-book-captions');
 expect(pkg.schemaVersion).toBe(4);
 expect(pkg.profiles.preview).toEqual(pkg.profiles.full);
 expect('book' in pkg.profiles.full&&pkg.profiles.full.book.schemaVersion).toBe(2);
 expect(()=>expectedCaptionPackage(parsed,{width:1920,height:1080},'v5.1-package-3-book-captions')).toThrow('FILM_CAPTION_CHANGED');
 expect(CaptionPackageSchema.safeParse({...pkg,schemaVersion:3}).success).toBe(false);
 expect(CaptionPackageSchema.safeParse({...pkg,font:{...font,family:'Crayon Book Handwriting'}}).success).toBe(false);
 expect(CaptionPackageSchema.safeParse({...pkg,profiles:{...pkg.profiles,full:{...pkg.profiles.full,book:{...('book' in pkg.profiles.full?pkg.profiles.full.book:{}),schemaVersion:1}}}}).success).toBe(false);
});
it('records versioned clear font receipts and preserves the historical receipt namespace',async()=>{
 const root=await mkdtemp(join(tmpdir(),'clear-font-'));
 try{const store=new FileStore(root),parsed=TimingDraftSchema.shape.font.parse(font);
  if(!parsed||parsed.family!=='Crayon Book Clear Handwriting')throw Error('TEST_FONT');
  await recordBookFontReceipt(store,parsed);
  const oldFaces=['mashanzheng','patrickhand'].map(id=>{const f=trustedStyleFont(id);return{id,family:f.family,fontSha256:f.font.sha256,fontBytes:f.font.bytes,licenseSha256:f.licenseFile.sha256,metadataSha256:f.metadata.sha256,charsetSha256:'b'.repeat(64)}});
  const old=AnyBookTimingFontSchema.parse({...font,family:'Crayon Book Handwriting',rendererSha256:bookCaptionRendererSha256,faces:oldFaces,charsetSha256:canonicalHash(oldFaces.map(f=>({id:f.id,charsetSha256:f.charsetSha256})))});
  await recordBookFontReceipt(store,old);
  expect(await frozenBookFontHashes(store,old)).toEqual(oldFaces.map(f=>f.fontSha256));
  expect(expectedCaptionPackage(old,{width:1920,height:1080},'v5.1-package-3-book-captions').schemaVersion).toBe(3);
  expect(await frozenBookFontHashes(store,parsed)).toEqual(faces.map(f=>f.fontSha256));
  expect(bookFontReceiptKey(font.runtimeDigest)).toBe(`runtime-receipts/${font.runtimeDigest}/book-font`);
  expect((await store.readFresh(`runtime-receipts/${font.runtimeDigest}/clear-book-font`)).value).toEqual(font);
  await expect(frozenBookFontHashes(store,{...parsed,faces:[...parsed.faces].reverse()})).rejects.toThrow();
  const key=bookFontReceiptKey(font.runtimeDigest,2),saved=await store.readFresh(key);
  await store.cas(key,saved.etag,old);
  await expect(readBookFontReceipt(store,font.runtimeDigest,2)).rejects.toThrow('FONT_RECEIPT_CHANGED');
 }finally{await rm(root,{recursive:true,force:true})}
});

it('requires mixed Chinese glyphs in the clear Chinese face and preserves old face selection',()=>{
 const glyphs=new Map([['longcang',new Set('种子。')],['mashanzheng',new Set('观察。')],['patrickhand',new Set('ABC.')]]);
 expect(()=>assertBookCaptionGlyphs(['种子。','ABC.'],glyphs,2)).not.toThrow();
 expect(()=>assertBookCaptionGlyphs(['种子ABC。'],glyphs,2)).toThrow('FONT_GLYPH_MISSING');
 expect(()=>assertBookCaptionGlyphs(['观察。'],glyphs)).not.toThrow();
 expect(()=>assertBookCaptionGlyphs(['观察。'],glyphs,2)).toThrow('FONT_GLYPH_MISSING');
});
