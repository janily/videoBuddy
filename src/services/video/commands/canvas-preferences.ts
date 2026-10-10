import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {UpdatePreferencesRequestSchema} from '@/contracts/video/commands';
import {UnderstandingSchema} from '@/contracts/video/domain';
import type {ArchivedMessage,ProjectControl} from '@/contracts/video/project';
import type {ProjectStore} from '@/services/video/storage/project-store';
import {createOrRead,updateJson} from '@/services/video/storage/atomic-store';
import {canonicalHash} from '@/services/video/domain/hash';
import {assertLiveProject,userActivity} from './user-activity';

/** The canvas intentionally offers a smaller choice than the general brief contract. */
export const CanvasPreferencesRequestSchema=UpdatePreferencesRequestSchema.extend({
 patch:z.strictObject({durationSec:z.union([z.literal(20),z.literal(25),z.literal(30)]).optional(),aspect:z.enum(['9:16','16:9']).optional()}).refine(p=>p.durationSec!==undefined||p.aspect!==undefined),
});
export type CanvasPreferencesRequest=z.infer<typeof CanvasPreferencesRequestSchema>;
export class CanvasPreferencesBusy extends Error{
 constructor(readonly lane:'production'|'conversation'){super('BUSY')}
}

/** Immutable objects are prepared first; one control CAS publishes the entire edit.
 * The user message in the permanent index is also the durable replay marker, so
 * crash recovery does not depend on a separate post-commit receipt write.
 * Production/conversation edits are rejected: their frozen input cannot safely
 * absorb this direct update. Users can retry after that operation finishes.
 */
export async function updateCanvasPreferences(projects:ProjectStore,owner:string,projectId:string,request:CanvasPreferencesRequest){
 if(!z.uuid().safeParse(projectId).success)throw Error('VALIDATION_FAILED');
 const parsed=CanvasPreferencesRequestSchema.safeParse(request);if(!parsed.success)throw Error('VALIDATION_FAILED');const input=parsed.data;
 await projects.access(owner,projectId);
 const hash=canonicalHash({kind:'canvas_preferences',body:input}),p=`projects/${projectId}`;
 const intent=await createOrRead(projects.store,`${p}/commands/${input.clientCommandId}`,{hash,userMessageId:randomUUID(),assistantMessageId:randomUUID(),admittedAt:Date.now()});
 if(intent.hash!==hash)throw Error('IDEMPOTENCY_CONFLICT');
 return updateJson(projects.store,`${p}/control`,async(c:ProjectControl)=>{
  if(c.ownerKeyHash!==owner)throw Error('ACCESS_NOT_FOUND');assertLiveProject(c);
  if((await projects.index.all(c.messagesIndexRef)).some(m=>m.id===intent.userMessageId))return c;
  if(c.briefVersion!==input.expectedBriefVersion)throw Error('BRIEF_CONFLICT');
  if(c.activeProduction)throw new CanvasPreferencesBusy('production');
  if(c.activeConversation)throw new CanvasPreferencesBusy('conversation');
  const understanding=UnderstandingSchema.parse((await projects.store.readFresh(c.understandingRef.key)).value);
  if(understanding.briefVersion!==c.briefVersion||canonicalHash(understanding)!==c.understandingRef.sha256)throw Error('BRIEF_CONFLICT');
  const changed=(input.patch.durationSec!==undefined&&input.patch.durationSec!==understanding.preferences.durationSec)||(input.patch.aspect!==undefined&&input.patch.aspect!==understanding.preferences.aspect);
  if(c.controlVersion>=Number.MAX_SAFE_INTEGER||c.nextOrdinal>Number.MAX_SAFE_INTEGER-2||changed&&c.briefVersion>=Number.MAX_SAFE_INTEGER)throw Error('CONTROL_SIZE_LIMIT');
  const briefVersion=c.briefVersion+(changed?1:0);
  const parts=[...(input.patch.durationSec===undefined?[]:[`时长改成 ${input.patch.durationSec} 秒`]),...(input.patch.aspect===undefined?[]:[`比例改成${input.patch.aspect==='9:16'?'竖屏（9:16）':'横屏（16:9）'}`])];
  const user:ArchivedMessage={id:intent.userMessageId,role:'user',origin:'canvas',ordinal:c.nextOrdinal,text:parts.join('，'),attachmentIds:[],clientMessageId:input.clientCommandId,status:'completed',contentVersion:1};
  const assistant:ArchivedMessage={id:intent.assistantMessageId,role:'assistant',ordinal:c.nextOrdinal+1,text:changed?`已更新：${parts.join('，')}。准备好后，点击画布上的“生成视频”。`:'已经是这个设置，想法和已有内容保持不变。',status:'completed',contentVersion:1};
  let messagesIndexRef=c.messagesIndexRef;
  for(const message of [user,assistant]){const ref=await projects.index.immutable(`${p}/messages/${message.id}/1`,message);messagesIndexRef=await projects.index.append(`${p}/indexes/messages`,messagesIndexRef,{id:message.id,ordinal:message.ordinal,ref})}
  const understandingRef=changed?await projects.index.immutable(`${p}/understanding/${briefVersion}`,{...understanding,briefVersion,preferences:{...understanding.preferences,...input.patch},sourceMessageIds:[...understanding.sourceMessageIds,intent.userMessageId]}):c.understandingRef;
  return{...c,...userActivity(undefined,Math.max(Date.parse(c.lastUserActivityAt),intent.admittedAt)),controlVersion:c.controlVersion+1,briefVersion,understandingRef,messagesIndexRef,nextOrdinal:c.nextOrdinal+2,...(changed?{phase:c.currentResultId?'ready' as const:'collecting' as const}:{})};
 });
}
