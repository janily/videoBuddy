import {userActivity} from '@/services/video/commands/user-activity';
import {randomUUID} from 'node:crypto';
import {PreparePreviewRequestSchema,type PreparePreviewRequest} from '@/contracts/video/commands';
import {UnderstandingSchema,type ObjectRef} from '@/contracts/video/domain';
import type {ProjectControl} from '@/contracts/video/project';
import type {ProjectStore} from '@/services/video/storage/project-store';
import {createOrRead,updateJson} from '@/services/video/storage/atomic-store';
import {canonicalHash,canonicalJson} from '@/services/video/domain/hash';
import {getStyle} from '@/services/video/styles/registry';
import type {LocalOperationQueue} from '@/services/video/commands/local-queue';
import {StartFailed,type Receipt} from '@/services/video/commands/submit';
import {assertMediaStopsResolved} from '@/services/video/media/stop-state';
interface Intent{hash:string;revisionId:string;previewId:string;receipt:Receipt}
export interface PreviewOperation{
 id:string;projectId:string;commandId:string;kind:'preview';status:string;canonicalRunId:string|null;streamEpoch:number;fence:number;
 revisionId:string;previewId:string;briefVersion:number;consentEpoch:number;understandingRef:ObjectRef;
 mediaAttemptStarted?:boolean;
}
const terminal=new Set(['succeeded','failed','cancelled','interrupted','superseded']);
export async function preparePreview(projects:ProjectStore,queue:LocalOperationQueue,owner:string,projectId:string,untrusted:PreparePreviewRequest):Promise<Receipt>{
 const request=PreparePreviewRequestSchema.parse(untrusted),prefix='projects/'+projectId;
 await projects.access(owner,projectId);
 const intentKey=prefix+'/commands/'+request.clientCommandId,hash=canonicalHash({kind:'prepare_preview',body:request});
 const intent=await createOrRead<Intent>(projects.store,intentKey,{hash,revisionId:randomUUID(),previewId:randomUUID(),receipt:{schemaVersion:5,commandId:request.clientCommandId,projectId,operationId:randomUUID(),controlVersion:0,status:'reserved'}});
 if(intent.hash!==hash)throw Error('IDEMPOTENCY_CONFLICT');
 async function dispatch(receipt:Receipt){
  const control=await projects.access(owner,projectId);
  if(control.activeProduction!==receipt.operationId)return;
  const operation=(await projects.store.readFresh<PreviewOperation>(prefix+'/operations/'+receipt.operationId)).value;
  if(terminal.has(operation.status))return;
  try{await queue.enqueue(projectId,receipt.operationId,'preview')}catch{throw new StartFailed(receipt)}
 }
 const control=await projects.access(owner,projectId),previous=control.receipts.find(r=>r.commandId===request.clientCommandId);
 if(intent.receipt.status!=='reserved'||previous){
  const receipt=previous||intent.receipt;if(receipt.operationId!==intent.receipt.operationId)throw Error('IDEMPOTENCY_CONFLICT');
  await updateJson(projects.store,intentKey,(value:Intent)=>({...value,receipt}));await dispatch(receipt);return{...receipt,status:'replayed'};
 }
 assertMediaStopsResolved(control);
 const understanding=UnderstandingSchema.parse((await projects.store.readFresh(control.understandingRef.key)).value);
 if(canonicalHash(understanding)!==control.understandingRef.sha256||Buffer.byteLength(canonicalJson(understanding))!==control.understandingRef.bytes||understanding.briefVersion!==request.expectedBriefVersion||control.briefVersion!==request.expectedBriefVersion)throw Error('BRIEF_CONFLICT');
 if(!understanding.subject.trim()||!understanding.preferences.styleSlug||understanding.unresolvedConflictIds.length)throw Error('PREVIEW_INPUT_INCOMPLETE');getStyle(understanding.preferences.styleSlug);
 if(request.sourceMessageId&&!(await projects.messages(control)).some(message=>message.id===request.sourceMessageId&&message.role==='user'&&message.status==='completed'))throw Error('AUTHORIZATION_REQUIRED');
 const assertBaseline=(current:ProjectControl)=>{
  if(current.deletedAt||current.ownerKeyHash!==owner||Date.parse(current.expiresAt)<=Date.now())throw Error('ACCESS_NOT_FOUND');
  assertMediaStopsResolved(current);
  if(current.activeProduction||current.activeConversation)throw Error('BUSY');
  if(Object.keys(current.previewOutcomes||{}).length>=16)throw Error('RECOVERY_REQUIRED');
  if(current.inputPending||understanding.assetUses.some(use=>use.required&&!current.assets.some(asset=>asset.id===use.assetId&&asset.status==='ready')))throw Error('INPUT_PENDING');
  if(!['collecting','preview_ready','ready','attention','cancelled'].includes(current.phase)||current.briefVersion!==request.expectedBriefVersion||canonicalHash(current.understandingRef)!==canonicalHash(control.understandingRef)||current.consentEpoch!==control.consentEpoch)throw Error('PREVIEW_STALE');
 };
 assertBaseline(control);
 const operation:PreviewOperation={id:intent.receipt.operationId,projectId,commandId:request.clientCommandId,kind:'preview',status:'reserved',canonicalRunId:null,streamEpoch:0,fence:0,revisionId:intent.revisionId,previewId:intent.previewId,briefVersion:control.briefVersion,consentEpoch:control.consentEpoch,understandingRef:control.understandingRef};
 const stored=await createOrRead(projects.store,prefix+'/operations/'+operation.id,operation);
 // A duplicate may race a worker claim/cancel. Compare immutable inputs only.
 for(const field of ['id','projectId','commandId','kind','revisionId','previewId','briefVersion','consentEpoch','understandingRef'] as const)if(canonicalHash(stored[field])!==canonicalHash(operation[field]))throw Error('IDEMPOTENCY_CONFLICT');
 const updated=await updateJson(projects.store,prefix+'/control',(current:ProjectControl)=>{
  if(current.receipts.some(receipt=>receipt.commandId===request.clientCommandId))return current;
  assertBaseline(current);const receipt={...intent.receipt,status:'accepted' as const,controlVersion:current.controlVersion+1};
  return{...current,...userActivity(current),controlVersion:receipt.controlVersion,phase:'preparing_preview' as const,activeProduction:operation.id,previewState:current.previewState==='ready'?'stale' as const:current.previewState,receipts:[...current.receipts.slice(-127),receipt]};
 });
 const receipt=updated.receipts.find(receipt=>receipt.commandId===request.clientCommandId)!;
 await updateJson(projects.store,intentKey,(value:Intent)=>({...value,receipt}));await dispatch(receipt);return receipt;
}
