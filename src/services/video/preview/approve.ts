import {randomUUID}from 'node:crypto';
import type{ApprovePreviewRequest,CommandReceipt}from '@/contracts/video/commands';
import{ApprovePreviewRequestSchema}from '@/contracts/video/commands';
import type{ProjectControl}from '@/contracts/video/project';
import{canonicalHash}from '@/services/video/domain/hash';
import{assertPreviewBaseline}from '@/services/video/domain/preview-policy';
import type{LocalOperationQueue}from '@/services/video/commands/local-queue';
import type{Receipt}from '@/services/video/commands/submit';
import{createOrRead,updateJson}from '@/services/video/storage/atomic-store';
import type{ProjectStore}from '@/services/video/storage/project-store';
import{readPreviewBundle}from './commit';

export interface ApprovalRecord{approvalId:string;projectId:string;previewId:string;revisionId:string;bundleHash:string;scriptHash:string;factsHash:string;briefVersion:number;clientCommandId:string;source:'preview_button';ownerKeyHash:string;approvedAt:string;consentEpoch:number}
interface ApprovalIntent{hash:string;approvalId:string;approvedAt:string;receipt:Receipt}
const terminal=new Set(['succeeded','cancelled','failed','interrupted','superseded']);

export async function approvePreview(projects:ProjectStore,queue:LocalOperationQueue,owner:string,projectId:string,untrusted:ApprovePreviewRequest):Promise<CommandReceipt>{
 const request=ApprovePreviewRequestSchema.parse(untrusted),p=`projects/${projectId}`;
 await projects.access(owner,projectId);
 const intentKey=`${p}/commands/${request.clientCommandId}`,hash=canonicalHash({kind:'approve_preview',body:request});
 const initial:ApprovalIntent={hash,approvalId:randomUUID(),approvedAt:new Date().toISOString(),receipt:{schemaVersion:5,commandId:request.clientCommandId,projectId,operationId:randomUUID(),controlVersion:0,status:'reserved'}};
 const intent=await createOrRead(projects.store,intentKey,initial);
 if(intent.hash!==hash||!intent.approvalId||!intent.receipt?.operationId)throw Error('IDEMPOTENCY_CONFLICT');
 const enqueueLive=async(receipt:Receipt)=>{
  const control=(await projects.store.readFresh<ProjectControl>(`${p}/control`)).value;
  if(control.activeProduction===receipt.operationId){
   const op=(await projects.store.readFresh<{status:string}>(`${p}/operations/${receipt.operationId}`)).value;
   if(!terminal.has(op.status))await queue.enqueue(projectId,receipt.operationId,'render');
  }
 };
 if(intent.receipt.status!=='reserved'){await enqueueLive(intent.receipt);return{...intent.receipt,status:'replayed'}};
 const controlAtReplay=(await projects.store.readFresh<ProjectControl>(`${p}/control`)).value;
 const previous=controlAtReplay.receipts.find(item=>item.commandId===request.clientCommandId)||
  (controlAtReplay.currentApprovalId===intent.approvalId&&controlAtReplay.activeProduction===intent.receipt.operationId?{...intent.receipt,controlVersion:controlAtReplay.controlVersion,status:'accepted' as const}:undefined);
 if(previous){if(previous.operationId!==intent.receipt.operationId)throw Error('IDEMPOTENCY_CONFLICT');await updateJson(projects.store,intentKey,(value:ApprovalIntent)=>({...value,receipt:previous}));await enqueueLive(previous);return{...previous,status:'replayed'}};
 const preview=await readPreviewBundle(projects,projectId,request.previewId);
 const initialControl=await projects.access(owner,projectId);
 assertPreviewBaseline({...initialControl,activeProduction:initialControl.activeProduction?{status:'running'}:null},preview,request);
 if(initialControl.phase!=='preview_ready'||initialControl.activeProduction)throw Error('PREVIEW_STALE');
 const approval:ApprovalRecord={approvalId:intent.approvalId,projectId,previewId:preview.previewId,revisionId:preview.revisionId,bundleHash:preview.bundleHash,scriptHash:preview.scriptHash,factsHash:preview.factsHash,briefVersion:preview.briefVersion,clientCommandId:request.clientCommandId,source:'preview_button',ownerKeyHash:owner,approvedAt:intent.approvedAt,consentEpoch:initialControl.consentEpoch};
 const existing=await createOrRead(projects.store,`${p}/approvals/${approval.approvalId}`,approval);
 if(canonicalHash(existing)!==canonicalHash(approval))throw Error('IDEMPOTENCY_CONFLICT');
 await createOrRead(projects.store,`${p}/operations/${intent.receipt.operationId}`,{id:intent.receipt.operationId,projectId,commandId:request.clientCommandId,kind:'render',status:'reserved',canonicalRunId:null,streamEpoch:0,fence:0,approvalId:approval.approvalId,bundleHash:approval.bundleHash,consentEpoch:approval.consentEpoch});
 const control=await updateJson(projects.store,`${p}/control`,(current:ProjectControl)=>{
  if(current.receipts.some(item=>item.commandId===request.clientCommandId))return current;
  assertPreviewBaseline({...current,activeProduction:current.activeProduction?{status:'running'}:null},preview,request);
  if(current.phase!=='preview_ready'||current.activeProduction||current.ownerKeyHash!==owner||current.consentEpoch!==approval.consentEpoch)throw Error('PREVIEW_STALE');
  const receipt:Receipt={...intent.receipt,status:'accepted',controlVersion:current.controlVersion+1};
  return{...current,controlVersion:receipt.controlVersion,phase:'rendering' as const,currentApprovalId:approval.approvalId,activeProduction:receipt.operationId,receipts:[...current.receipts.slice(-127),receipt]};
 });
 const receipt=control.receipts.find(item=>item.commandId===request.clientCommandId)!;
 await updateJson(projects.store,intentKey,(value:ApprovalIntent)=>({...value,receipt}));
 await enqueueLive(receipt);
 return receipt.status==='accepted'?receipt:{...receipt,status:'replayed'};
}
