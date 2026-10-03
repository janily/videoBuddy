import {randomUUID,createHash} from 'node:crypto';
import {z} from 'zod';
import type {AtomicStore} from '@/services/video/storage/atomic-store';
import {createOrRead,StoreMissing,updateJson} from '@/services/video/storage/atomic-store';
import {ProjectStore} from '@/services/video/storage/project-store';
import type {ProjectControl} from '@/contracts/video/project';
import {StreamEventSchema} from '@/contracts/video/commands';
import type {LocalEventLog} from '@/services/video/stream/local-event-log';
import {claimOperation} from '@/services/video/commands/claim';
import {canonicalHash} from '@/services/video/domain/hash';
import {prepareFrozenSourceArchive} from './source-archive';
import {persistArchiveObject} from './archive-object';
import {exportBaseline,exportKey,type ExportPublication} from './publication';
import type {ArtifactRecord} from './access';
import {actualArtifactSha256} from './verified-file';
import {DurableExportFormatSchema,exportFiles,type DurableExportFormat} from './formats';
import {prepareExportDocument} from './documents';

export interface ExportOperation{id:string;projectId:string;commandId:string;kind:'export';status:string;errorCode?:string;canonicalRunId:string|null;streamEpoch:number;fence:number;controlVersion:number;ownerKeyHash:string;resultId:string;resultHash:string;sourceArtifactId:string;revisionId:string;previewId:string;bundleHash:string;artifactId:string;format:DurableExportFormat}
type Outcome={status:'succeeded'|'failed'|'cancelled'|'interrupted'|'superseded';errorCode?:string};
const terminal=new Set(['succeeded','failed','cancelled','interrupted','superseded']);
async function emitTerminal(events:LocalEventLog,op:ExportOperation,outcome:Outcome){
 const payload={...outcome,retryable:false};
 if((await events.readFrom(op.projectId,op.id,0)).some(({event})=>event.epoch===op.streamEpoch&&event.type==='operation.terminal'&&canonicalHash(event.payload)===canonicalHash(payload)))return;
 await events.append(StreamEventSchema.parse({schemaVersion:5,projectId:op.projectId,operationId:op.id,epoch:op.streamEpoch,eventId:randomUUID(),createdAt:new Date().toISOString(),type:'operation.terminal',payload}));
}
export async function cancelExport(projects:ProjectStore,owner:string,projectId:string,operationId:string,events?:LocalEventLog){
 await projects.access(owner,projectId);const key=`projects/${projectId}/operations/${operationId}`,op=(await projects.store.readFresh<ExportOperation>(key)).value;
 if(op.id!==operationId||op.projectId!==projectId||op.kind!=='export'||op.ownerKeyHash!==owner)throw Error('ACCESS_NOT_FOUND');
 const control=await updateJson(projects.store,`projects/${projectId}/control`,(c:ProjectControl)=>{
  if(c.deletedAt||c.ownerKeyHash!==owner)throw Error('ACCESS_NOT_FOUND');
  if(c.publishedExports?.[op.artifactId]||terminal.has(op.status)||c.exportCancellations?.includes(operationId))return c;
  return{...c,controlVersion:c.controlVersion+1,exportCancellations:[...(c.exportCancellations||[]).slice(-127),operationId]};
 });
 if(control.publishedExports?.[op.artifactId]||terminal.has(op.status)&&op.status!=='cancelled')return'already_completed';
 const cancelled=await updateJson(projects.store,key,(current:ExportOperation)=>terminal.has(current.status)?current:{...current,status:current.canonicalRunId?'cancelling':'cancelled',fence:current.fence+1});
 if(cancelled.status==='cancelled'&&events){await createOrRead(projects.store,key+'/export-outcome',{status:'cancelled'});await emitTerminal(events,cancelled,{status:'cancelled'})}
 return cancelled.status==='cancelled'?'cancelled':terminal.has(cancelled.status)?'already_completed':'cancelling';
}
export async function runExportOperation(store:AtomicStore,events:LocalEventLog,projectId:string,operationId:string,options:{root:string;build?:typeof prepareFrozenSourceArchive}){
 if(![projectId,operationId].every(id=>z.uuid().safeParse(id).success))throw Error('VALIDATION_FAILED');
 const key=`projects/${projectId}/operations/${operationId}`,projects=new ProjectStore(store),before=(await store.readFresh<ExportOperation>(key)).value;
 if(before.id!==operationId||before.projectId!==projectId||before.kind!=='export'||!DurableExportFormatSchema.safeParse(before.format).success)throw Error('EXPORT_FENCED');
 async function finish(outcome:Outcome){
  const saved=await createOrRead(store,key+'/export-outcome',outcome);if(canonicalHash(saved)!==canonicalHash(outcome))throw Error('EXPORT_OUTCOME_CHANGED');
  await emitTerminal(events,before,outcome);await updateJson(store,key,(current:ExportOperation)=>({...current,...outcome}));
 }
 try{const outcome=(await store.readFresh<Outcome>(key+'/export-outcome')).value;await finish(outcome);return}catch(error){if(!(error instanceof StoreMissing))throw error}
 if(before.status==='cancelled'){await finish({status:'cancelled'});return}
 if(before.status==='failed'||before.status==='interrupted'||before.status==='superseded'){await finish({status:before.status,...(before.errorCode?{errorCode:before.errorCode}:{})});return}
 const slot=(await store.readFresh<ExportOperation>(`projects/${projectId}/results/${before.resultId}/export-requests/${before.format}`)).value;
 for(const field of ['id','projectId','commandId','controlVersion','kind','ownerKeyHash','resultId','resultHash','sourceArtifactId','revisionId','previewId','bundleHash','artifactId','format'] as const)if(canonicalHash(slot[field])!==canonicalHash(before[field]))throw Error('EXPORT_FENCED');
 if(before.status!=='succeeded'&&!(await claimOperation(store,key,operationId)).claimed&&before.status!=='cancelling')return;
 const op=(await store.readFresh<ExportOperation>(key)).value;
 async function assertActive(){
  const c=await projects.access(op.ownerKeyHash,projectId),current=(await store.readFresh<ExportOperation>(key)).value;
  if(c.exportCancellations?.includes(operationId)||current.status!=='running'||current.fence!==op.fence||current.resultHash!==op.resultHash||current.ownerKeyHash!==op.ownerKeyHash)throw Error('EXPORT_FENCED');
  const baseline=await exportBaseline(projects,op.ownerKeyHash,projectId,op.sourceArtifactId,options.root);
  if(baseline.result.resultId!==op.resultId||baseline.resultHash!==op.resultHash||baseline.bundle.revisionId!==op.revisionId||baseline.bundle.previewId!==op.previewId||baseline.bundle.bundleHash!==op.bundleHash)throw Error('EXPORT_FENCED');
  return baseline;
 }
 try{
  const c=(await store.readFresh<ProjectControl>(`projects/${projectId}/control`)).value;
  if(c.projectId!==projectId||c.ownerKeyHash!==op.ownerKeyHash)throw Error('EXPORT_FENCED');
  if(c.publishedExports?.[op.artifactId]){
   const publication=(await store.readFresh<ExportPublication>(`projects/${projectId}/artifacts/${op.artifactId}/export-publication`)).value;
   if(publication.operationId!==operationId||canonicalHash(publication)!==c.publishedExports[op.artifactId]||publication.resultHash!==op.resultHash)throw Error('EXPORT_FENCED');
   if(!c.deletedAt&&Date.parse(c.expiresAt)>Date.now())await actualArtifactSha256(options.root,publication.objectRef.key,publication.objectRef.bytes).then(sha=>{if(sha!==publication.objectRef.sha256)throw Error('ARTIFACT_INVALID')});
   await finish({status:'succeeded'});return;
  }
  await assertActive();
  const built=op.format==='source_zip'?await (options.build||prepareFrozenSourceArchive)(projects,op.ownerKeyHash,projectId,op.previewId,options.root):await prepareExportDocument(projects,op.ownerKeyHash,projectId,op.sourceArtifactId,op.format,options.root);
  if(createHash('sha256').update(built.bytes).digest('hex')!==built.sha256||built.manifest.bundleHash!==op.bundleHash||built.manifest.revisionId!==op.revisionId)throw Error('ARTIFACT_INVALID');
  await assertActive();
  const file=exportFiles[op.format],objectRef={key:`projects/${projectId}/artifacts/${op.artifactId}/files/${file.file}`,sha256:built.sha256,bytes:built.bytes.length,mime:file.mime};
  await persistArchiveObject(options.root,objectRef.key,built.sha256,built.bytes);
  const artifact:ArtifactRecord={id:op.artifactId,revisionId:op.revisionId,objectRef,qaPassed:true,uploaded:true,filename:file.filename};
  if(canonicalHash(await createOrRead(store,`projects/${projectId}/artifacts/${op.artifactId}/manifest`,artifact))!==canonicalHash(artifact))throw Error('ARTIFACT_INVALID');
  await assertActive();
  const publication:ExportPublication={schemaVersion:1,projectId,resultId:op.resultId,sourceArtifactId:op.sourceArtifactId,revisionId:op.revisionId,bundleHash:op.bundleHash,resultHash:op.resultHash,format:op.format,artifactId:op.artifactId,operationId,objectRef};
  if(canonicalHash(await createOrRead(store,`projects/${projectId}/artifacts/${op.artifactId}/export-publication`,publication))!==canonicalHash(publication))throw Error('EXPORT_FENCED');
  const publicationKey=exportKey(projectId,op.resultId,op.format);
  await createOrRead(store,publicationKey,publication);
  await updateJson(store,publicationKey,async(current:ExportPublication)=>{
   if(canonicalHash(current)===canonicalHash(publication))return current;
   const c=(await store.readFresh<ProjectControl>(`projects/${projectId}/control`)).value;
   if(c.publishedExports?.[current.artifactId])throw Error('EXPORT_FENCED');
   const slot=(await store.readFresh<ExportOperation>(`projects/${projectId}/results/${op.resultId}/export-requests/${op.format}`)).value;
   if(slot.id!==operationId)throw Error('EXPORT_FENCED');return publication;
  });
  // This control CAS is the visibility point. Cancellation writes the same control first.
  await updateJson(store,`projects/${projectId}/control`,async(current:ProjectControl)=>{
   if(current.publishedExports?.[op.artifactId]===canonicalHash(publication))return current;
   if(current.deletedAt||current.ownerKeyHash!==op.ownerKeyHash||Date.parse(current.expiresAt)<=Date.now()||current.exportCancellations?.includes(operationId)||![current.currentResultId,current.previousResultId].includes(op.resultId))throw Error('EXPORT_FENCED');
   const live=(await store.readFresh<ExportOperation>(key)).value;if(live.status!=='running'||live.fence!==op.fence)throw Error('EXPORT_FENCED');
   if(Object.keys(current.publishedExports||{}).length>=128)throw Error('EXPORT_LIMIT');
   return{...current,controlVersion:current.controlVersion+1,publishedExports:{...current.publishedExports,[op.artifactId]:canonicalHash(publication)}};
  });
  await finish({status:'succeeded'});
 }catch(error){
  const c=(await store.readFresh<ProjectControl>(`projects/${projectId}/control`)).value;
  // A lost acknowledgement after publication/outcome must resume, never overwrite success.
  if(c.publishedExports?.[op.artifactId])throw error;
  try{await store.readFresh(key+'/export-outcome');throw error}catch(missing){if(!(missing instanceof StoreMissing))throw missing}
  const raw=error instanceof Error?error.message.split(':')[0]:'',safe=new Set(['QUALITY_BLOCKED','ARTIFACT_INVALID','ARCHIVE_INVALID','ARCHIVE_PRIVATE_DATA','ARCHIVE_SOURCE_CHANGED','ARCHIVE_ASSET_REDISTRIBUTION_REQUIRED','PREVIEW_PACKAGE_INVALID','EXPORT_LIMIT','EXPORT_NOT_APPLICABLE','EXPORT_DOCUMENT_INVALID']);
  const cancelled=c.exportCancellations?.includes(operationId),outcome:Outcome={status:cancelled?'cancelled':raw==='EXPORT_FENCED'||raw==='RESULT_STALE'||raw==='ACCESS_NOT_FOUND'||raw==='PROJECT_EXPIRED'?'superseded':'failed',...(cancelled?{}:{errorCode:safe.has(raw)?raw:'EXPORT_FAILED'})};
  await finish(outcome);
 }
}
