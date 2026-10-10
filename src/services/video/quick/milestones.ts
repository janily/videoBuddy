import {randomUUID} from 'node:crypto';
import type {ArchivedMessage,ProjectControl} from '@/contracts/video/project';
import {guidanceUI,type GuidanceUI} from '@/contracts/video/guidance-ui';
import {canonicalHash} from '@/services/video/domain/hash';
import {createOrRead,updateJson} from '@/services/video/storage/atomic-store';
import type {ProjectStore} from '@/services/video/storage/project-store';
import {userErrorMessage} from '@/services/video/http/user-messages';

export type AssistantMilestone='script-ready'|'film-started'|'film-completed'|'film-failed';
export function milestoneContent(kind:AssistantMilestone,summary=''):{text:string;ui:GuidanceUI}{
 if(kind==='script-ready'){
  const characters=[...summary],brief=characters.length>35?characters.slice(0,35).join('')+'…':summary;
  return{text:`脚本写好了：${brief}。在画布上看脚本，想改哪一镜直接说，没问题就点生成视频。`,ui:{canvasFocus:'script',canvasRefs:[{text:'在画布上看脚本',target:'script'}]}};
 }
 if(kind==='film-started')return{text:'开始生成了，大约需要 3–5 分钟。画布上会依次出现每个镜头。',ui:{canvasFocus:'script',canvasRefs:[{text:'每个镜头',target:'script'}]}};
 if(kind==='film-completed')return{text:'视频做好了！可以下载，也可以挑一个想调整的镜头，点“重画这一镜”再试一版。',ui:{canvasFocus:'result',canvasRefs:[{text:'视频做好了',target:'result'},{text:'重画这一镜',target:'script'}]}};
 return{text:userErrorMessage('QUICK_FILM_FAILED'),ui:{canvasFocus:'result'}};
}

/** A durable key per operation/milestone plus one CAS prevents replay spam and
 * reserves an ordinal without stealing an in-flight conversation's ordinals.
 * No user message or model call is invented for these factual status updates.
 */
export async function archiveAssistantMilestone(projects:ProjectStore,projectId:string,operationId:string,kind:AssistantMilestone,content:{text:string;ui:GuidanceUI},accept?:(control:ProjectControl)=>boolean){
 const prefix=`projects/${projectId}`,ui=guidanceUI(content.ui,content.text);
 const intent=await createOrRead(projects.store,`${prefix}/operations/${operationId}/milestones/${kind}`,{messageId:randomUUID(),text:content.text,ui});
 if(intent.text!==content.text||canonicalHash(intent.ui)!==canonicalHash(ui))throw Error('MILESTONE_CHANGED');
 const saved=await updateJson(projects.store,`${prefix}/control`,async(c:ProjectControl)=>{
  if(c.deletedAt||Date.parse(c.expiresAt)<=Date.now()||accept&&!accept(c))return c;
  if((await projects.index.all(c.messagesIndexRef)).some(entry=>entry.id===intent.messageId))return c;
  const message:ArchivedMessage={id:intent.messageId,ordinal:c.nextOrdinal,role:'assistant',text:intent.text,ui:intent.ui,status:'completed',contentVersion:1,operationId};
  const ref=await projects.index.immutable(`${prefix}/messages/${message.id}/1`,message);
  return{...c,controlVersion:c.controlVersion+1,nextOrdinal:c.nextOrdinal+1,messagesIndexRef:await projects.index.append(`${prefix}/indexes/messages`,c.messagesIndexRef,{id:message.id,ordinal:message.ordinal,ref})};
 });
 const entry=(await projects.index.all(saved.messagesIndexRef)).find(value=>value.id===intent.messageId);
 return entry?{messageId:intent.messageId,contentVersion:1,archiveRevision:entry.ref.sha256}:null;
}
