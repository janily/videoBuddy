import {randomUUID} from 'node:crypto';
import {mkdir,mkdtemp,readFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {FileStore} from '../../src/services/video/storage/file-store';
import {canonicalHash} from '../../src/services/video/domain/hash';
import {readNarrationJson} from '../../src/services/video/audio/narration-package';
import type {TimingDraft} from '../../src/services/video/preview/timing-draft';
import {bookCaptionStyle,prepareBookCaptionLayer} from '../../src/services/video/media/book-caption-layer';
import {bookCaptionSafeBox} from '../../src/services/video/timeline/package';
import {claimProbeReport,persistProbeReport} from './helpers/probe-report';
async function main(){
 if(process.argv.slice(2).join(' ')!=='--verify-clear-handwriting-layer')throw Error('CLEAR_CAPTION_PROBE_REQUIRED');
 const source=JSON.parse(await readFile('docs/engineering/evidence/new-theme-book-caption-preview-v2-probe.json','utf8')),op=source.stages.operation,sourceStore=new FileStore(source.root),prefix=`projects/${source.projectId}/`,revisionPrefix=prefix+`revisions/${op.revisionId}/`,timingRecord=source.stages.stageRecords['timing-stage'];
 if(canonicalHash((await sourceStore.readFresh(revisionPrefix+'timing-stage')).value)!==canonicalHash(timingRecord))throw Error('CLEAR_CAPTION_SOURCE_CHANGED');
 const timing=await readNarrationJson(sourceStore,timingRecord.draftRef,revisionPrefix+'timing-draft/') as TimingDraft;
 const keys=[prefix+'control',prefix+'budget',prefix+'operations/'+op.id],before=await Promise.all(keys.map(async key=>canonicalHash((await sourceStore.readFresh(key)).value)));
 const path='docs/engineering/evidence/clear-caption-layer-probe.json',image=(await readFile('.video-local/font-builds/longcang-406197b9/image.id','utf8')).trim();
 if(image!=='sha256:c91e4b1e1fe665b5017da982aed5a0f7b45fa11e2416207caa09304135d92623'||timing.durationMs!==20000||timing.fps!==24||timing.captions.length!==4)throw Error('CLEAR_CAPTION_BASELINE_CHANGED');
 const parent=resolve('.video-local/clear-caption');await mkdir(parent,{recursive:true});const root=await mkdtemp(join(parent,'probe-')),store=new FileStore(root),journal={store,prefix:`projects/${randomUUID()}/operations/${randomUUID()}/media-effects`};
 const style=bookCaptionStyle({width:1920,height:1080},bookCaptionSafeBox({width:1920,height:1080}),2),cues=timing.captions.map(c=>({...c,startMs:Math.round(c.startFrame*1000/timing.fps),endMs:Math.round(c.endFrame*1000/timing.fps)})),spec={width:1280,height:720,durationSec:20,fps:24 as const,bundleHash:canonicalHash({sourceTimingRef:timingRecord.draftRef,style}),fence:0},env={VIDEO_MEDIA_IMAGE_REF:image,VIDEO_MEDIA_RUNTIME_DIGEST:image.slice(7),VIDEO_MEDIA_TIMEOUT_SECONDS:'600'};
 const report:Record<string,unknown>={executedAt:new Date().toISOString(),status:'started',root,image,sourceProjectId:source.projectId,sourceRevisionId:op.revisionId,sourceTimingRef:timingRecord.draftRef,style,spec,journalPrefix:journal.prefix,newModelCalls:0,formalProductionApproval:false,deliveryEligible:false};await claimProbeReport(path,report);
 try{
  const result=await prepareBookCaptionLayer(root,cues,style,spec,env,{journal});report.result=result;await persistProbeReport(path,report);
  const middle=await store.listKeys(journal.prefix,1),cold=await prepareBookCaptionLayer(root,cues,style,spec,env,{journal,mustExist:true});
  if(canonicalHash(cold)!==canonicalHash(result)||canonicalHash(middle)!==canonicalHash(await store.listKeys(journal.prefix,1)))throw Error('CLEAR_CAPTION_COLD_CHANGED');
  if(canonicalHash(before)!==canonicalHash(await Promise.all(keys.map(async key=>canonicalHash((await sourceStore.readFresh(key)).value)))))throw Error('CLEAR_CAPTION_SOURCE_CHANGED');
  report.sourceControlBudgetOperationUnchanged=true;report.coldMatches=true;report.newColdNativeCalls=0;report.status='actual_clear_caption_layer_and_cold_receipts_verified';
 }catch(error){report.status='failed';report.errorCode=(error as Error).message;process.exitCode=1}
 finally{report.invocations=await Promise.all((await store.listKeys(journal.prefix,1)).map(async k=>(await store.readFresh(k)).value));await persistProbeReport(path,report);console.log(JSON.stringify({status:report.status,errorCode:report.errorCode,root,newModelCalls:0}))}
}
main().catch(error=>{console.error(error.message);process.exitCode=1});
