import {z} from 'zod';
import type {ProjectControl,ArchivedMessage} from '@/contracts/video/project';
import {UnderstandingPatchSchema,type Understanding} from '@/contracts/video/domain';
import type {ProjectStore} from '@/services/video/storage/project-store';
import {canonicalHash} from '@/services/video/domain/hash';
import {updateJson} from '@/services/video/storage/atomic-store';
import {applyUnderstandingPatch,type SourceMessage} from '@/mastra/video/director';
export const PendingFeedbackSchema=z.strictObject({
 schemaVersion:z.literal(5),operationId:z.string().uuid(),userMessageIds:z.array(z.string().uuid()).min(1),
 baseline:z.strictObject({productionOperationId:z.string().uuid(),briefVersion:z.number().int().nonnegative(),consentEpoch:z.number().int().nonnegative(),currentResultId:z.string().uuid().optional()}),
 proposedPatch:UnderstandingPatchSchema.optional(),execution:z.enum(['not_started','applied']),appliedBriefVersion:z.number().int().nonnegative().optional(),
});
export async function deferDirectorFeedback(projects:ProjectStore,current:ProjectControl,baseline:ProjectControl,operationId:string,messages:ArchivedMessage[],patch:unknown){
 const userMessageIds=messages.filter(message=>message.role==='user'&&message.operationId===operationId&&message.status==='completed').map(message=>message.id);
 const proposedPatch=patch===undefined?undefined:UnderstandingPatchSchema.parse(patch);
 if(!userMessageIds.length||(proposedPatch&&!proposedPatch.operations.some(op=>op.sourceMessageIds.some(id=>userMessageIds.includes(id)))))throw Error('SOURCE_INVALID');
 const feedback=PendingFeedbackSchema.parse({schemaVersion:5,operationId,userMessageIds,baseline:{productionOperationId:baseline.activeProduction,briefVersion:baseline.briefVersion,consentEpoch:baseline.consentEpoch,...(baseline.currentResultId?{currentResultId:baseline.currentResultId}:{})},...(proposedPatch?{proposedPatch}:{}),execution:'not_started'});
 const prefix=`projects/${current.projectId}/indexes/pending-feedback`;
 const root=current.pendingFeedbackIndexRef??await projects.index.empty(prefix);
 const ref=await projects.index.immutable(`projects/${current.projectId}/pending-feedback/${operationId}`,feedback);
 const ordinal=messages.find(message=>message.id===userMessageIds[0])!.ordinal;
 return await projects.index.append(prefix,root,{id:operationId,ordinal,ref});
}
export async function pendingFeedbackMessageIds(projects:ProjectStore,control:ProjectControl){
 if(!control.pendingFeedbackIndexRef)return[];
 const records=await pendingRecords(projects,control);
 const baselines=continuingBaselines(records.map(item=>item.record),control);
 const ids:string[]=[];
 for(const {record} of records)if(record.execution==='not_started'&&record.baseline.consentEpoch===control.consentEpoch&&baselines.has(record.baseline.briefVersion))ids.push(...record.userMessageIds);
 return [...new Set(ids)];
}
async function pendingRecords(projects:ProjectStore,control:ProjectControl){
 if(!control.pendingFeedbackIndexRef)return[];
 return Promise.all((await projects.index.all(control.pendingFeedbackIndexRef)).map(async entry=>{
  const raw=(await projects.store.readFresh(entry.ref.key)).value;
  if(canonicalHash(raw)!==entry.ref.sha256)throw Error('PENDING_FEEDBACK_CHANGED');
  const record=PendingFeedbackSchema.parse(raw);
  if(record.operationId!==entry.id)throw Error('PENDING_FEEDBACK_CHANGED');
  return{entry,record};
 }));
}
function continuingBaselines(records:z.infer<typeof PendingFeedbackSchema>[],control:ProjectControl){
 const versions=new Set([control.briefVersion]);
 for(const record of records)if(record.execution==='applied'&&record.appliedBriefVersion===control.briefVersion&&record.baseline.consentEpoch===control.consentEpoch)versions.add(record.baseline.briefVersion);
 return versions;
}

/** Resolve an old clarification only after a real, sourced edit was applied.
 * A queued request with no patch never becomes applied merely by waiting.
 */
export async function resolvePendingDirectorFeedback(projects:ProjectStore,control:ProjectControl,patch:z.infer<typeof UnderstandingPatchSchema>,appliedBriefVersion:number){
 let index=control.pendingFeedbackIndexRef;if(!index||appliedBriefVersion<=control.briefVersion)return index;
 const sources=new Set(patch.operations.flatMap(op=>op.sourceMessageIds));
 for(const {entry,record} of await pendingRecords(projects,control)){
  if(record.execution!=='not_started'||record.proposedPatch||record.baseline.consentEpoch!==control.consentEpoch||!record.userMessageIds.every(id=>sources.has(id))||![...sources].some(id=>!record.userMessageIds.includes(id)))continue;
  const ref=await projects.index.immutable(`projects/${control.projectId}/pending-feedback/${record.operationId}`,{...record,execution:'applied',appliedBriefVersion});
  index=await projects.index.append(`projects/${control.projectId}/indexes/pending-feedback`,index,{...entry,ref});
 }
 return index;
}

/** Apply only after both production and chat have released their frozen inputs.
 * One CAS publishes the new brief and consumed records; a cold retry is a no-op.
 * Publication changing currentResultId does not revoke a next-version request.
 */
export async function applyPendingDirectorFeedback(projects:ProjectStore,projectId:string){
 const p=`projects/${projectId}`;
 return updateJson(projects.store,`${p}/control`,async(c:ProjectControl)=>{
  if(c.deletedAt||Date.parse(c.expiresAt)<=Date.now()||c.activeProduction||c.activeConversation||!c.pendingFeedbackIndexRef)return c;
  const records=await pendingRecords(projects,c),baselines=continuingBaselines(records.map(item=>item.record),c);
  let next=(await projects.store.readFresh<Understanding>(c.understandingRef.key)).value,index=c.pendingFeedbackIndexRef,applied=false;
  if(canonicalHash(next)!==c.understandingRef.sha256||next.briefVersion!==c.briefVersion)throw Error('BRIEF_CONFLICT');
  for(const {entry,record} of records){
   if(record.execution==='applied'||!record.proposedPatch||record.baseline.consentEpoch!==c.consentEpoch||!baselines.has(record.baseline.briefVersion))continue;
   const frozen=(await projects.store.readFresh<{sha256:string;input:{understanding:Understanding;context:SourceMessage[];control:ProjectControl}}>(`${p}/operations/${record.operationId}/director-input`)).value;
   if(canonicalHash(frozen.input)!==frozen.sha256||frozen.input.control.projectId!==projectId||frozen.input.control.activeConversation!==record.operationId)throw Error('DIRECTOR_INPUT_CHANGED');
   const original=frozen.input.understanding;
   // Validate on the original sourced context before rebasing to prior queued
   // edits. Unchanged summary fields must not erase an earlier queued edit.
   applyUnderstandingPatch(original,record.proposedPatch,frozen.input.context);
   const operations=record.proposedPatch.operations.map(op=>{
    if(op.op!=='replace_summary')return op;
    const rebased={...op,summary:canonicalHash(op.summary)===canonicalHash(original.summary)?next.summary:op.summary};
    for(const field of ['subject','audience','objective'] as const)if(rebased[field]===original[field])delete rebased[field];
    return rebased;
   });
   next=applyUnderstandingPatch(next,{...record.proposedPatch,baseBriefVersion:next.briefVersion,operations},frozen.input.context);
   const ref=await projects.index.immutable(`${p}/pending-feedback/${record.operationId}`,{...record,execution:'applied',appliedBriefVersion:next.briefVersion});
   index=await projects.index.append(`${p}/indexes/pending-feedback`,index,{...entry,ref});applied=true;
   index=(await resolvePendingDirectorFeedback(projects,{...c,pendingFeedbackIndexRef:index},record.proposedPatch,next.briefVersion))!;
  }
  if(!applied)return c;
  return{...c,controlVersion:c.controlVersion+1,briefVersion:next.briefVersion,understandingRef:await projects.index.immutable(`${p}/understanding/${next.briefVersion}`,next),pendingFeedbackIndexRef:index};
 });
}
