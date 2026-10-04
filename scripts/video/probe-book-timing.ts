import {randomUUID} from 'node:crypto';
import {mkdir,mkdtemp,readFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {FileStore} from '../../src/services/video/storage/file-store';
import {readBookTimingFont,assertBookCaptionGlyphs} from '../../src/services/video/audio/book-font';
import {recordBookFontReceipt,frozenBookFontHashes} from '../../src/services/video/audio/book-font-receipt';
import {compileSubtitles} from '../../src/services/video/audio/subtitles';
import {canonicalHash} from '../../src/services/video/domain/hash';
import {claimProbeReport,persistProbeReport} from './helpers/probe-report';
import type {VerifiedNarrationManifest} from '../../src/services/video/audio/asr';
async function main(){
 if(process.argv.slice(2).join(' ')!=='--verify-installed-book-timing')throw Error('BOOK_TIMING_FLAG_REQUIRED');
 const image=(await readFile(resolve('.video-local/font-builds/locked-406197b9-local-base/image.id'),'utf8')).trim();
 if(image!=='sha256:46a3a937735e1f0472fecc8e32b78da99c7da187aa1faac7017c523b92911dfb')throw Error('BOOK_TIMING_IMAGE_CHANGED');
 const parent=resolve('.video-local/book-timing');await mkdir(parent,{recursive:true});const root=await mkdtemp(join(parent,'probe-')),store=new FileStore(root),journal={store,prefix:`projects/${randomUUID()}/operations/${randomUUID()}/media-effects`};
 const path='docs/engineering/evidence/book-timing-probe.json',report:Record<string,unknown>={executedAt:new Date().toISOString(),status:'started',root,image,newModelCalls:0,deliveryEligible:false,formalProductionApproval:false,sourceProjectChanged:false};await claimProbeReport(path,report);
 try{
  const source=new FileStore(resolve('.video-local/new-theme/seed-oD7Sxk')),key='projects/4a5c6131-3842-440c-a551-7d8fcf6e7c95/revisions/35f71e39-809d-479d-b23e-3aca60ab6e41/voice-verified/c505dd1758f1b3e043f9005a7221a53fc7456af0726ca7f413b6b8664a2a41b2',manifest=(await source.readFresh<VerifiedNarrationManifest>(key)).value;
  if(canonicalHash(manifest)!==key.split('/').at(-1))throw Error('SOURCE_MANIFEST_CHANGED');
  const actual=await readBookTimingFont({VIDEO_MEDIA_IMAGE_REF:image,VIDEO_MEDIA_RUNTIME_DIGEST:image.slice(7),VIDEO_MEDIA_TIMEOUT_SECONDS:'60'},{journal});assertBookCaptionGlyphs(manifest.lines.map(line=>line.displayText),actual.glyphsById);
  await recordBookFontReceipt(store,actual.font);const hashes=await frozenBookFontHashes(store,actual.font),glyphs=new Set([...actual.glyphsById.values()].flatMap(set=>[...set])),plain=compileSubtitles(manifest,24,glyphs),book=compileSubtitles(manifest,24,glyphs,{revealMs:350});
  if(book.some((cue,index)=>cue.endFrame!==plain[index].endFrame+9))throw Error('BOOK_REVEAL_TIMING_CHANGED');
  const cold=new FileStore(root);if(canonicalHash(await frozenBookFontHashes(cold,actual.font))!==canonicalHash(hashes))throw Error('BOOK_FONT_COLD_CHANGED');
  report.font=actual.font;report.sourceManifestSha256=canonicalHash(manifest);report.plainCues=plain;report.bookCues=book;report.stableReadableFrames=book.map(c=>c.startFrame+9);report.coldFontReceiptVerified=true;report.status='installed_fonts_real_narration_timing_and_cold_receipt_verified';
 }catch(error){report.status='failed';report.errorCode=String((error as Error).message).slice(0,300);process.exitCode=1}
 finally{report.invocations=await Promise.all((await store.listKeys(journal.prefix,1)).map(async key=>(await store.readFresh(key)).value));await persistProbeReport(path,report);console.log(JSON.stringify({status:report.status,errorCode:report.errorCode,newModelCalls:0}))}
}
main().catch(error=>{console.error(error.message);process.exitCode=1});
