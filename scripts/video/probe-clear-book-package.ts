import {randomUUID} from 'node:crypto';
import {mkdir,mkdtemp,readFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {FileStore} from '../../src/services/video/storage/file-store';
import {canonicalHash} from '../../src/services/video/domain/hash';
import {readNarrationJson} from '../../src/services/video/audio/narration-package';
import {TimingDraftSchema} from '../../src/services/video/preview/timing-draft';
import {readBookTimingFont,assertBookCaptionGlyphs} from '../../src/services/video/audio/book-font';
import {recordBookFontReceipt,frozenBookFontHashes} from '../../src/services/video/audio/book-font-receipt';
import {expectedCaptionPackage,CaptionPackageSchema} from '../../src/contracts/video/film-package';
import {clearBookFilmPackagePolicyVersion} from '../../src/services/video/timeline/package';
import {createOrRead} from '../../src/services/video/storage/atomic-store';
import {claimProbeReport,persistProbeReport} from './helpers/probe-report';
async function main(){
 if(process.argv.slice(2).join(' ')!=='--verify-clear-book-package')throw Error('CLEAR_BOOK_PACKAGE_FLAG_REQUIRED');
 const source=JSON.parse(await readFile('docs/engineering/evidence/new-theme-book-caption-preview-v2-probe.json','utf8')),op=source.stages.operation,sourceStore=new FileStore(source.root),prefix=`projects/${source.projectId}/`,revisionPrefix=prefix+`revisions/${op.revisionId}/`,timingRecord=source.stages.stageRecords['timing-stage'];
 if(canonicalHash((await sourceStore.readFresh(revisionPrefix+'timing-stage')).value)!==canonicalHash(timingRecord))throw Error('CLEAR_BOOK_SOURCE_CHANGED');
 const timing=TimingDraftSchema.parse(await readNarrationJson(sourceStore,timingRecord.draftRef,revisionPrefix+'timing-draft/'));
 const keys=[prefix+'control',prefix+'budget',prefix+'operations/'+op.id],before=await Promise.all(keys.map(async key=>canonicalHash((await sourceStore.readFresh(key)).value)));
 const image=(await readFile('.video-local/font-builds/longcang-406197b9/image.id','utf8')).trim();
 if(image!=='sha256:c91e4b1e1fe665b5017da982aed5a0f7b45fa11e2416207caa09304135d92623'||timing.captions.length!==4||timing.font?.family!=='Crayon Book Handwriting')throw Error('CLEAR_BOOK_BASELINE_CHANGED');
 const parent=resolve('.video-local/clear-book-package');await mkdir(parent,{recursive:true});const root=await mkdtemp(join(parent,'probe-')),store=new FileStore(root),journal={store,prefix:`projects/${randomUUID()}/operations/${randomUUID()}/media-effects`},path='docs/engineering/evidence/clear-book-package-probe.json';
 const report:Record<string,unknown>={executedAt:new Date().toISOString(),status:'started',root,image,journalPrefix:journal.prefix,sourceTimingRef:timingRecord.draftRef,newModelCalls:0,formalProductionApproval:false,deliveryEligible:false};await claimProbeReport(path,report);
 try{
  const installed=await readBookTimingFont({VIDEO_MEDIA_IMAGE_REF:image,VIDEO_MEDIA_RUNTIME_DIGEST:image.slice(7),VIDEO_MEDIA_TIMEOUT_SECONDS:'60'},{version:2,journal});
  assertBookCaptionGlyphs(timing.captions.map(c=>c.text),installed.glyphsById,2);
  await recordBookFontReceipt(store,installed.font);const hashes=await frozenBookFontHashes(store,installed.font);
  // A diagnostic draft, never installed into the original business revision.
  const diagnostic=TimingDraftSchema.parse({...timing,font:installed.font,track:{...timing.track,runtimeDigest:installed.font.runtimeDigest}});
  const horizontal=expectedCaptionPackage(diagnostic.font,{width:1920,height:1080},clearBookFilmPackagePolicyVersion),vertical=expectedCaptionPackage(diagnostic.font,{width:1080,height:1920},clearBookFilmPackagePolicyVersion);
  for(const [name,pkg] of Object.entries({horizontal,vertical}))await createOrRead(store,`diagnostic-caption-package/${name}`,pkg);
  const cold=new FileStore(root);
  for(const [name,pkg] of Object.entries({horizontal,vertical}))if(canonicalHash(CaptionPackageSchema.parse((await cold.readFresh(`diagnostic-caption-package/${name}`)).value))!==canonicalHash(pkg))throw Error('CLEAR_BOOK_PACKAGE_COLD_CHANGED');
  if(canonicalHash(await frozenBookFontHashes(cold,installed.font))!==canonicalHash(hashes))throw Error('CLEAR_BOOK_FONT_COLD_CHANGED');
  if(canonicalHash(before)!==canonicalHash(await Promise.all(keys.map(async key=>canonicalHash((await sourceStore.readFresh(key)).value)))))throw Error('CLEAR_BOOK_SOURCE_CHANGED');
  report.font=installed.font;report.fontHashes=hashes;report.horizontal=horizontal;report.vertical=vertical;report.captions=diagnostic.captions;report.sourceControlBudgetOperationUnchanged=true;report.coldMatches=true;report.newColdNativeCalls=0;report.status='installed_clear_fonts_versioned_packages_and_cold_receipts_verified';
 }catch(error){report.status='failed';report.errorCode=(error as Error).message;process.exitCode=1}
 finally{report.invocations=await Promise.all((await store.listKeys(journal.prefix,1)).map(async k=>(await store.readFresh(k)).value));await persistProbeReport(path,report);console.log(JSON.stringify({status:report.status,errorCode:report.errorCode,root,newModelCalls:0}))}
}
main().catch(error=>{console.error(error.message);process.exitCode=1});
