import {composeVideo} from '../../src/services/video/media/compose';
import {verifyPostMixNarration} from '../../src/services/video/audio/postmix-asr';
import {readFile} from 'node:fs/promises';
import {FileStore} from '../../src/services/video/storage/file-store';
import {ProjectStore} from '../../src/services/video/storage/project-store';
import {prepareCompositeStage} from '../../src/services/video/preview/composite-stage';
import {canonicalHash} from '../../src/services/video/domain/hash';
import {StoreConflict,StoreMissing,type AtomicStore} from '../../src/services/video/storage/atomic-store';
import {claimProbeReport,persistProbeReport} from './helpers/probe-report';
async function main(){
 if(process.argv.slice(2).join(' ')!=='--readonly-clear-composition-diagnosis')throw Error('EXPLICIT_DIAGNOSIS_REQUIRED');
 const source=JSON.parse(await readFile('docs/engineering/evidence/new-theme-clear-book-caption-preview-probe.json','utf8')),operation=source.stages.operation,store=new FileStore(source.root),key=`projects/${source.projectId}/control`,control=(await store.readFresh<Record<string,unknown>>(key)).value;
 if(operation.status!=='failed'||operation.stage!=='composition'||source.requests.length!==5)throw Error('DIAGNOSTIC_SOURCE_CHANGED');
 const originalKeys=await store.listKeys(`projects/${source.projectId}/operations/${operation.id}/media-effects`,1),before=canonicalHash(control);
 const overlay:AtomicStore={readFresh:async<T>(k:string)=>k===key?{value:{...control,phase:'preparing_preview',activeProduction:operation.id,inputPending:false} as T,etag:'readonly-overlay'}:store.readFresh<T>(k),create:async(k:string)=>{try{await store.readFresh(k)}catch(e){if(e instanceof StoreMissing)throw Error('DIAGNOSTIC_WRITE_FORBIDDEN');throw e}throw new StoreConflict()},cas:async()=>{throw Error('DIAGNOSTIC_WRITE_FORBIDDEN')}};
 const digest='c91e4b1e1fe665b5017da982aed5a0f7b45fa11e2416207caa09304135d92623',asr='caa3fca3e3e6866dab7351346367768db612bb411f06fbd4a7a44f767747f5d4',env={VIDEO_MEDIA_IMAGE_REF:'sha256:'+digest,VIDEO_MEDIA_RUNTIME_DIGEST:digest,VIDEO_MEDIA_TIMEOUT_SECONDS:'600',VIDEO_VOICE_IMAGE_REF:'sha256:b145374e774d91aa729569a65e06fe0038009398a55ae8d31e025b227642c8d6',VIDEO_VOICE_RUNTIME_DIGEST:'b145374e774d91aa729569a65e06fe0038009398a55ae8d31e025b227642c8d6',VIDEO_ASR_IMAGE_REF:'sha256:'+asr,VIDEO_ASR_RUNTIME_DIGEST:asr,VIDEO_ASR_MODEL:'Systran/faster-whisper-medium'};
 const treatmentRef=(source.stages.stageRecords['film-package-v2-stage']?await store.readFresh<{treatmentRef:{key:string}}>(source.stages.stageRecords['film-package-v2-stage'].filmSpecRef.key):undefined)?.value.treatmentRef;
 if(!treatmentRef)throw Error('DIAGNOSTIC_FILM_MISSING');
 const document=(await store.readFresh<{planRef:Parameters<typeof prepareCompositeStage>[5]}>(treatmentRef.key)).value;
 const path='docs/engineering/evidence/clear-book-composition-diagnosis-v2.json',report:Record<string,unknown>={executedAt:new Date().toISOString(),mode:'readonly_control_overlay_all_writes_forbidden',newModelCalls:0};await claimProbeReport(path,report);
 try{await prepareCompositeStage(new ProjectStore(overlay),source.projectId,operation.revisionId,operation.id,operation.consentEpoch,document.planRef,{root:source.root,env,profile:'preview',compose:(root,pictures,track,cues,style,spec,env,options)=>composeVideo(root,pictures,track,cues,style,spec,env,{...options,mustExist:true}),postMix:(...args)=>verifyPostMixNarration(args[0],args[1],args[2],args[3],args[4],args[5],{...args[6],mustExist:true})});report.status='unexpected_success'}catch(error){report.status='readonly_composite_failure_observed';report.errorCode=(error as Error).message;report.stack=(error as Error).stack;report.cause=(error as Error).cause instanceof Error?{message:((error as Error).cause as Error).message,stack:((error as Error).cause as Error).stack}:undefined}
 report.originalControlUnchanged=before===canonicalHash((await store.readFresh(key)).value);report.originalNativeJournalUnchanged=canonicalHash(originalKeys)===canonicalHash(await store.listKeys(`projects/${source.projectId}/operations/${operation.id}/media-effects`,1));await persistProbeReport(path,report);console.log(JSON.stringify(report));
}
main().catch(e=>{console.error(e.message);process.exitCode=1});
