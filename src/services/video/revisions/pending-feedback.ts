import {z} from 'zod';
import type {ProjectControl,ArchivedMessage} from '@/contracts/video/project';
import {UnderstandingPatchSchema} from '@/contracts/video/domain';
import type {ProjectStore} from '@/services/video/storage/project-store';
import {canonicalHash} from '@/services/video/domain/hash';
export const PendingFeedbackSchema=z.strictObject({
 schemaVersion:z.literal(5),operationId:z.string().uuid(),userMessageIds:z.array(z.string().uuid()).min(1),
 baseline:z.strictObject({productionOperationId:z.string().uuid(),briefVersion:z.number().int().nonnegative(),consentEpoch:z.number().int().nonnegative(),currentResultId:z.string().uuid().optional()}),
 proposedPatch:UnderstandingPatchSchema.optional(),execution:z.literal('not_started'),
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
 const ids:string[]=[];
 for(const entry of await projects.index.all(control.pendingFeedbackIndexRef)){
  const raw=(await projects.store.readFresh(entry.ref.key)).value;
  if(canonicalHash(raw)!==entry.ref.sha256)throw Error('PENDING_FEEDBACK_CHANGED');
  const record=PendingFeedbackSchema.parse(raw);
  if(record.operationId!==entry.id)throw Error('PENDING_FEEDBACK_CHANGED');
  if(record.baseline.consentEpoch===control.consentEpoch&&record.baseline.briefVersion===control.briefVersion&&record.baseline.currentResultId===control.currentResultId)ids.push(...record.userMessageIds);
 }
 return [...new Set(ids)];
}
