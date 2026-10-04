import {readFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {FileStore} from '../../src/services/video/storage/file-store';
import {canonicalHash} from '../../src/services/video/domain/hash';
import {composeVideo} from '../../src/services/video/media/compose';
import {bookCaptionStyle} from '../../src/services/video/media/book-caption-layer';
import {inspectStereoTrackWav} from '../../src/services/video/audio/wav';
import {claimProbeReport,persistProbeReport} from './helpers/probe-report';
async function main(){
 if(process.argv.slice(2).join(' ')!=='--verify-book-final-producer-receipt')throw Error('BOOK_COLD_FLAG_REQUIRED');
 const source=JSON.parse(await readFile('docs/engineering/evidence/book-composition-probe.json','utf8'));
 if(source.status!=='real_book_composition_and_cold_receipts_verified'||!source.root.startsWith(resolve('.video-local/book-composition')+'/'))throw Error('BOOK_COLD_SOURCE_INVALID');
 const root=source.root,store=new FileStore(root),journal={store,prefix:source.journalPrefix},keys=(await store.listKeys(journal.prefix,1)).sort(),before=await Promise.all(keys.map(async key=>(await store.readFresh(key)).value)),path='docs/engineering/evidence/book-composition-v2-probe.json',report:Record<string,unknown>={executedAt:new Date().toISOString(),status:'started',sourceRoot:root,sourceFilmSha256:source.composed.technicalQa.sha256,journalPrefix:journal.prefix,invocationsBefore:before,newModelCalls:0,deliveryEligible:false};
 await claimProbeReport(path,report);
 try{
  const style=bookCaptionStyle({width:1920,height:1080},{x:100,y:800,width:1720,height:200}),imported={sourceSha256:source.importedMaster.sourceSha256,outputSha256:source.importedMaster.outputSha256},spec={width:1280,height:720,durationSec:20,fps:24 as const,bundleHash:canonicalHash({sourceTiming:source.sourceTimingSha256,pictureSha:source.sourcePictureSha256,imported,cues:source.derivedCues,style}),fence:0};
  const pictureStage=resolve('.video-local/new-theme/seed-oD7Sxk/picture-sequence/268b71b616d4685fc88b3b440b9ad6c0fb1a4737123ef3c613dcb9858b0eba9e'),trackPath=join(root,'track','master.wav'),wav=await inspectStereoTrackWav(trackPath,960000,false),env={VIDEO_MEDIA_IMAGE_REF:source.image,VIDEO_MEDIA_RUNTIME_DIGEST:source.image.slice(7),VIDEO_MEDIA_TIMEOUT_SECONDS:'900'};
  const composed=await composeVideo(root,pictureStage,{outputPath:trackPath,runtimeDigest:source.image.slice(7),wav,kind:'film_mix',qaStatus:'not_checked'},source.derivedCues,style,spec,env,{journal});
  report.composed=composed;await persistProbeReport(path,report);
  const middleKeys=(await store.listKeys(journal.prefix,1)).sort(),middle=await Promise.all(middleKeys.map(async key=>(await store.readFresh(key)).value));
  if(middleKeys.length!==keys.length+1||keys.some((key,index)=>canonicalHash(middle[middleKeys.indexOf(key)])!==canonicalHash(before[index])))throw Error('BOOK_FINAL_PRODUCER_COUNT_CHANGED');
  const result=await composeVideo(root,pictureStage,{outputPath:trackPath,runtimeDigest:source.image.slice(7),wav,kind:'film_mix',qaStatus:'not_checked'},source.derivedCues,style,spec,env,{journal,mustExist:true});
  if(canonicalHash(result)!==canonicalHash(composed))throw Error('BOOK_COLD_OUTPUT_CHANGED');
  const afterKeys=(await store.listKeys(journal.prefix,1)).sort(),after=await Promise.all(afterKeys.map(async key=>(await store.readFresh(key)).value));
  if(canonicalHash(afterKeys)!==canonicalHash(middleKeys)||canonicalHash(after)!==canonicalHash(middle)||after.some(record=>(record as {state:string}).state!=='completed'))throw Error('BOOK_COLD_PRODUCER_CHANGED');
  report.result=result;report.invocationsAfter=after;report.newNativeProducerInvocations=1;report.coldNativeProducerInvocations=0;report.status='final_book_receipt_stdout_and_cold_cache_verified';
 }catch(error){report.status='failed';report.errorCode=String((error as Error).message).split('\n')[0].slice(0,300);process.exitCode=1}
 finally{await persistProbeReport(path,report);console.log(JSON.stringify({status:report.status,errorCode:report.errorCode,newModelCalls:0}))}
}
main().catch(error=>{console.error(String(error.message));process.exitCode=1});
