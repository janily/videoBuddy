import {readFile} from 'node:fs/promises';
import {FileStore} from '../../src/services/video/storage/file-store';
import {ProjectStore} from '../../src/services/video/storage/project-store';
import {prepareCompositeStage} from '../../src/services/video/preview/composite-stage';
import {canonicalHash} from '../../src/services/video/domain/hash';
import {StoreConflict,StoreMissing,type AtomicStore} from '../../src/services/video/storage/atomic-store';
import {claimProbeReport,persistProbeReport} from './helpers/probe-report';
async function main(){
 const source=JSON.parse(await readFile('docs/engineering/evidence/book-frozen-preview-continuation-probe.json','utf8')),mix=JSON.parse(await readFile('docs/engineering/evidence/book-preview-postmix-probe.json','utf8')),store=new FileStore(source.root),key=`projects/${source.projectId}/control`,control=(await store.readFresh<Record<string,unknown>>(key)).value;
 if(source.operation.status!=='failed'||source.operation.stage!=='composition'||source.requests.length!==0)throw Error('DIAGNOSTIC_SOURCE_CHANGED');
 const originalKeys=await store.listKeys(`projects/${source.projectId}/operations/${source.operation.id}/media-effects`,1),before=canonicalHash(control);
 const overlay:AtomicStore={readFresh:async<T>(k:string)=>k===key?{value:{...control,phase:'preparing_preview',activeProduction:source.operation.id,inputPending:false} as T,etag:'readonly-overlay'}:store.readFresh<T>(k),create:async(k:string)=>{try{await store.readFresh(k)}catch(e){if(e instanceof StoreMissing)throw Error('DIAGNOSTIC_WRITE_FORBIDDEN');throw e}throw new StoreConflict()},cas:async()=>{throw Error('DIAGNOSTIC_WRITE_FORBIDDEN')}};
 const digest=mix.context.window.mediaRuntimeDigest,asr=mix.context.transcript.runtimeDigest,env={VIDEO_MEDIA_IMAGE_REF:'sha256:'+digest,VIDEO_MEDIA_RUNTIME_DIGEST:digest,VIDEO_MEDIA_TIMEOUT_SECONDS:'600',VIDEO_VOICE_IMAGE_REF:'sha256:b145374e774d91aa729569a65e06fe0038009398a55ae8d31e025b227642c8d6',VIDEO_VOICE_RUNTIME_DIGEST:'b145374e774d91aa729569a65e06fe0038009398a55ae8d31e025b227642c8d6',VIDEO_ASR_IMAGE_REF:'sha256:'+asr,VIDEO_ASR_RUNTIME_DIGEST:asr,VIDEO_ASR_MODEL:mix.context.transcript.model};
 const command=(await store.readFresh<{frozenPreview:{treatmentRef:Parameters<typeof prepareCompositeStage>[5]}}>(`projects/${source.projectId}/commands/${source.operation.commandId}`)).value;
 const path='docs/engineering/evidence/book-frozen-composition-diagnosis-v4.json',report:Record<string,unknown>={executedAt:new Date().toISOString(),mode:'readonly_control_overlay_all_writes_forbidden',newModelCalls:0};await claimProbeReport(path,report);
 try{await prepareCompositeStage(new ProjectStore(overlay),source.projectId,source.sourceRevisionId,source.operation.id,source.operation.consentEpoch,command.frozenPreview.treatmentRef,{root:source.root,env,profile:'preview',frozenFilm:mix.context.film});report.status='unexpected_success'}catch(error){report.status='exact_failure_reproduced';report.errorCode=(error as Error).message;report.stack=(error as Error).stack;report.cause=(error as Error).cause instanceof Error?{message:((error as Error).cause as Error).message,stack:((error as Error).cause as Error).stack}:undefined}
 report.originalControlUnchanged=before===canonicalHash((await store.readFresh(key)).value);report.originalNativeJournalUnchanged=canonicalHash(originalKeys)===canonicalHash(await store.listKeys(`projects/${source.projectId}/operations/${source.operation.id}/media-effects`,1));await persistProbeReport(path,report);console.log(JSON.stringify(report));
}
main().catch(e=>{console.error(e.message);process.exitCode=1});
