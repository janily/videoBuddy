import {randomUUID} from 'node:crypto';
import {ExportRequestSchema,type ExportRequest} from '@/contracts/video/commands';
import type {ProjectStore} from '@/services/video/storage/project-store';
import type {LocalOperationQueue} from '@/services/video/commands/local-queue';
import {createOrRead,StoreMissing,StoreConflict,updateJson} from '@/services/video/storage/atomic-store';
import {canonicalHash} from '@/services/video/domain/hash';
import {getArtifactAccess} from './access';
import {exportBaseline,exportKey,ExportPublicationSchema} from './publication';
import type {ExportOperation} from './operation';
import {actualArtifactSha256} from './verified-file';
import {assertWorkerReady} from '@/services/video/commands/worker-heartbeat';
import {StartFailed,type Receipt} from '@/services/video/commands/submit';
import {bindReservedExportCommand,type ExportIntent} from './intent';
import {DurableExportFormatSchema} from './formats';
const terminal=new Set(['succeeded','failed','cancelled','interrupted','superseded']);
export async function requestExport(projects:ProjectStore,queue:LocalOperationQueue,owner:string,projectId:string,untrusted:ExportRequest,root:string){
 const request=ExportRequestSchema.parse(untrusted),control=await projects.access(owner,projectId);
 const hash=canonicalHash({kind:'export',body:request}),prefix=`projects/${projectId}`;
 const intentKey=prefix+'/commands/'+request.clientCommandId,intent=await createOrRead<ExportIntent>(projects.store,intentKey,{kind:'export',hash});
 if(intent.hash!==hash)throw Error('IDEMPOTENCY_CONFLICT');
 const baseline=await exportBaseline(projects,owner,projectId,request.artifactId,root);
 if(request.format==='mp4')return{status:200 as const,artifactId:request.artifactId,access:await getArtifactAccess(projects,owner,projectId,request.artifactId,'download')};
 const format=DurableExportFormatSchema.parse(request.format),publicationKey=exportKey(projectId,baseline.result.resultId,format);
 try{
  const publication=ExportPublicationSchema.parse((await projects.store.readFresh(publicationKey)).value),control=await projects.access(owner,projectId);
  if(control.publishedExports?.[publication.artifactId]===canonicalHash(publication)){
   if(publication.resultHash!==baseline.resultHash||publication.format!==format)throw Error('RESULT_STALE');
   if(await actualArtifactSha256(root,publication.objectRef.key,publication.objectRef.bytes)!==publication.objectRef.sha256)throw Error('ARTIFACT_INVALID');
   return{status:200 as const,artifactId:publication.artifactId,access:await getArtifactAccess(projects,owner,projectId,publication.artifactId,'download')};
  }
 }catch(error){if(!(error instanceof StoreMissing))throw error}
 // One input-bound slot coalesces concurrent commands for the same immutable result.
 const proposed:ExportOperation={id:randomUUID(),projectId,commandId:request.clientCommandId,kind:'export',status:'reserved',canonicalRunId:null,streamEpoch:0,fence:0,controlVersion:control.controlVersion,ownerKeyHash:owner,resultId:baseline.result.resultId,resultHash:baseline.resultHash,sourceArtifactId:request.artifactId,revisionId:baseline.result.revisionId,previewId:baseline.result.previewId,bundleHash:baseline.result.bundleHash,artifactId:randomUUID(),format};
 const slotKey=`${prefix}/results/${baseline.result.resultId}/export-requests/${format}`;
 let operation:ExportOperation;
 if(intent.operation)operation=intent.operation;
 else{
  operation=await createOrRead(projects.store,slotKey,proposed);
  for(let attempt=0;attempt<5;attempt++){
   const slot=await projects.store.readFresh<ExportOperation>(slotKey);operation=slot.value;
   const original=await bindReservedExportCommand(projects.store,operation);
   if(operation.commandId===request.clientCommandId){operation=original.operation!;break}
   let status='reserved';try{status=(await projects.store.readFresh<ExportOperation>(prefix+'/operations/'+operation.id)).value.status}catch(error){if(!(error instanceof StoreMissing))throw error}
   if(!terminal.has(status))break;
   try{await projects.store.cas(slotKey,slot.etag,proposed);operation=proposed;break}catch(error){if(!(error instanceof StoreConflict)||attempt===4)throw error}
  }
  // Bind before dispatch. A repeated command never switches to a later attempt.
  const bound=await updateJson(projects.store,intentKey,(value:ExportIntent)=>({...value,operation:value.operation||operation}));
  operation=bound.operation!;
 }
 if(operation.resultHash!==baseline.resultHash||operation.sourceArtifactId!==request.artifactId||operation.ownerKeyHash!==owner||operation.format!==format)throw Error('RESULT_STALE');
 const current=await createOrRead(projects.store,prefix+'/operations/'+operation.id,operation);
 if(current.id!==operation.id||current.projectId!==projectId||current.kind!=='export'||current.resultHash!==operation.resultHash)throw Error('IDEMPOTENCY_CONFLICT');
 const receipt:Receipt={schemaVersion:5,commandId:request.clientCommandId,projectId,operationId:operation.id,controlVersion:operation.controlVersion,status:terminal.has(current.status)?'completed':'accepted'};
 if(!terminal.has(current.status))try{await assertWorkerReady(root);await queue.enqueue(projectId,operation.id,'export')}catch{throw new StartFailed({...receipt,status:'reserved'})}
 return{status:202 as const,operationId:operation.id,receipt};
}
