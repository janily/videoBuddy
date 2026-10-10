'use client';
import {useCallback,useEffect,useRef,useState,useSyncExternalStore} from 'react';
import type {ProjectView,ArchivedMessage} from '@/contracts/video/project';
import {draftKey,readDraft,saveDraft,useDraft} from './use-draft';
import {rememberProject} from './recent-projects';
import {useProjectEvents} from './use-project-events';
import {useRestoreResult} from './use-restore-result';
import {useProjectRevalidation} from './use-project-revalidation';
import {feedbackTarget,FeedbackSelectionSchema,parseMessageIntent,type MessageIntent} from '@/services/video/revisions/client-contract';
import {trackCanvasEvent} from '@/services/video/analytics/client';
import type {StreamEvent} from '@/contracts/video/commands';
import type {FeedbackTarget} from '@/contracts/video/commands';
function feedbackKey(projectId:string){return `vb-feedback:${projectId}`}
function pendingMessageKey(projectId:string){return `vb-message:${projectId}`}
function sameTarget(a:FeedbackTarget|null|undefined,b:FeedbackTarget|null|undefined){return a?.artifactId===b?.artifactId&&a?.revisionId===b?.revisionId&&a?.sourceTimeMs===b?.sourceTimeMs}
async function messageLock<T>(projectId:string,action:()=>T):Promise<T>{
 if(!navigator.locks)throw Error('此浏览器暂不支持消息恢复，草稿已保留。');
 return navigator.locks.request(pendingMessageKey(projectId),action);
}
async function clearMessageIntent(projectId:string,expected:MessageIntent){
 return messageLock(projectId,()=>{
  const raw=localStorage.getItem(pendingMessageKey(projectId)),current=raw?parseMessageIntent(raw,projectId):null;
  if(current?.request.clientCommandId===expected.request.clientCommandId&&current.request.clientMessageId===expected.request.clientMessageId){localStorage.removeItem(pendingMessageKey(projectId));return null}
  return current;
 });
}
function parseSelection(raw:string,projectId?:string):FeedbackTarget|null|undefined{
 if(!raw)return undefined;
 try{const value=FeedbackSelectionSchema.safeParse(JSON.parse(raw));return value.success&&value.data.projectId===projectId?value.data.target:null}catch{return null}
}
function subscribeFeedback(notify:()=>void){window.addEventListener('storage',notify);window.addEventListener('vb-feedback',notify);return()=>{window.removeEventListener('storage',notify);window.removeEventListener('vb-feedback',notify)}}

async function api<T>(path:string,body?:unknown):Promise<T>{
 const response=await fetch(path,body===undefined?{cache:'no-store'}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 const value=await response.json();
 if(!response.ok)throw Error(value.error?.message||'服务暂时不可用，内容已保留。');
 return value as T;
}
async function ensureSession(){const create=()=>api('/api/video/session',{});if(navigator.locks)return navigator.locks.request('vb-session',create);return create()}
type PendingAttachment={id:string;filename:string};
function attachmentKey(projectId:string){return `vb-pending-attachments:${projectId}`}
function parseAttachments(raw:string):PendingAttachment[]{
 try{const value=JSON.parse(raw);return Array.isArray(value)?value.filter(item=>typeof item.id==='string'&&typeof item.filename==='string'):[]}
 catch{return []}
}
function readAttachments(projectId:string){try{return parseAttachments(localStorage.getItem(attachmentKey(projectId))||'[]')}catch{return []}}
function saveAttachments(projectId:string,attachments:PendingAttachment[]){try{localStorage.setItem(attachmentKey(projectId),JSON.stringify(attachments));window.dispatchEvent(new Event('vb-attachments'))}catch{}}
function subscribeAttachments(notify:()=>void){window.addEventListener('storage',notify);window.addEventListener('vb-attachments',notify);return()=>{window.removeEventListener('storage',notify);window.removeEventListener('vb-attachments',notify)}}
async function uploadBytes(url:string,file:File,mime:'text/markdown'|'application/pdf'){
 const response=await fetch(url,{method:'PUT',headers:{'Content-Type':mime},body:file});
 const value=await response.json();
 if(!response.ok)throw Error(value.error?.message||'资料上传失败，请重试。');
}

export function useProject(initialProjectId?:string){
 const [projectId,setProjectId]=useState(initialProjectId),[view,setView]=useState<ProjectView|null>(null),[error,setError]=useState(''),[sending,setSending]=useState(false),[uploading,setUploading]=useState(false);
 const sendingRef=useRef(false),quickBusy=useRef(false),operationStarted=useRef(new Map<string,number>()),milestones=useRef(new Set<string>()),quickIntent=useRef<{signature:string;commandId:string}|null>(null);
 const idRef=useRef(initialProjectId),createId=useRef<string|undefined>(undefined);
 const [pendingMessage,setPendingMessage]=useState<MessageIntent|null>(null);
 const feedbackSnapshot=useCallback(()=>{if(!projectId)return'';try{return localStorage.getItem(feedbackKey(projectId))||''}catch{return'invalid'}},[projectId]);
 const selection=parseSelection(useSyncExternalStore(subscribeFeedback,feedbackSnapshot,()=>''),projectId);
 const generateCommand=useRef<{briefVersion:number;commandId:string}|undefined>(undefined),generateBusy=useRef(false);
 const [generating,setGenerating]=useState(false);
 const key=draftKey(projectId),[draft,saveCurrentDraft]=useDraft(key);
 const feedback=feedbackTarget(view,selection);
 function selectFeedback(artifactId:string,revisionId:string){
  const id=idRef.current;if(!id)return;
  try{const value=FeedbackSelectionSchema.parse({version:1,projectId:id,target:{artifactId,revisionId,sourceTimeMs:null}});localStorage.setItem(feedbackKey(id),JSON.stringify(value));window.dispatchEvent(new Event('vb-feedback'))}catch{setError('无法保存反馈对象，请检查浏览器存储后重试。')}
 }
 function setDraft(text:string){if(selection===undefined&&feedback.target)selectFeedback(feedback.target.artifactId,feedback.target.revisionId);saveCurrentDraft(text)}
 const attachmentSnapshot=useCallback(()=>projectId?localStorage.getItem(attachmentKey(projectId))||'[]':'[]',[projectId]);
 const attachments=parseAttachments(useSyncExternalStore(subscribeAttachments,attachmentSnapshot,()=> '[]'));
 const readProject=useCallback(async(minimumControlVersion=0)=>{
  const id=idRef.current;if(!id)throw Error('无法读取项目。');
  const next=await api<ProjectView>(`/api/video/projects/${id}`);
  if(next.projectId!==id||!Number.isSafeInteger(next.controlVersion)||next.controlVersion<minimumControlVersion)throw Error('最新视频暂时无法读取，请重新连接。');
  for(const op of [next.activeScript,next.activeProduction])if(op&&!operationStarted.current.has(op.id))operationStarted.current.set(op.id,Date.now());
  if(operationStarted.current.size>32)operationStarted.current.delete(operationStarted.current.keys().next().value!);
  rememberProject(next.projectId);setView(old=>old&&old.controlVersion>next.controlVersion?old:next);
  const raw=localStorage.getItem(pendingMessageKey(id)),pending=raw?parseMessageIntent(raw,id):null;
  if(pending&&!next.activeConversation&&next.messages.some(message=>message.role==='user'&&message.clientMessageId===pending.request.clientMessageId)){setPendingMessage(await clearMessageIntent(id,pending))}else setPendingMessage(pending);
 },[]);
 const refresh=useCallback(async(event?:StreamEvent)=>{if(!idRef.current)return;try{
  await readProject();
  if(event&&!milestones.current.has(event.eventId)){
   milestones.current.add(event.eventId);if(milestones.current.size>128)milestones.current.delete(milestones.current.values().next().value!);
   if(event.type==='shot.updated')trackCanvasEvent(idRef.current,{name:'shot_state',payload:{state:event.payload.state}});
   const began=operationStarted.current.get(event.operationId);
   if(began!==undefined&&(event.type==='script.ready'||event.type==='result.ready')){trackCanvasEvent(idRef.current,{name:event.type==='script.ready'?'script_ready':'result_ready',payload:{ms:Math.max(0,Date.now()-began)}});operationStarted.current.delete(event.operationId)}
  }
 }catch(e){setError(e instanceof Error?e.message:'无法恢复项目。')}},[readProject]);
 const restoration=useRestoreResult(projectId,readProject);
 const projectUpdate=useProjectRevalidation(projectId,refresh);
 useEffect(()=>{if(initialProjectId)void readProject().catch(e=>setError(e instanceof Error?e.message:'无法恢复项目。'))},[initialProjectId,readProject]);
 const stream=useProjectEvents(projectId,view?.activeConversation?.id,view?.activeConversation?.streamEpoch||0,refresh);
 const productionStream=useProjectEvents(projectId,view?.activeProduction?.id,view?.activeProduction?.streamEpoch||0,refresh,false);
 const scriptStream=useProjectEvents(projectId,view?.activeScript?.id,view?.activeScript?.streamEpoch||0,refresh,false);
 const scriptPending=Boolean(view?.activeScript);
 useEffect(()=>{if(!scriptPending)return;const timer=window.setInterval(()=>void refresh(),2000);return()=>window.clearInterval(timer)},[scriptPending,refresh]);
 const pendingAnalysis=attachments.some(attachment=>!view?.assets.some(asset=>asset.id===attachment.id&&['ready','failed'].includes(asset.status)));
 useEffect(()=>{if(!pendingAnalysis)return;const timer=window.setInterval(()=>void refresh(),2000);return()=>window.clearInterval(timer)},[pendingAnalysis,refresh]);

 async function ensureProject(){
  await ensureSession();
  if(!idRef.current){
   createId.current ||= crypto.randomUUID();
   const created=await api<{projectId:string}>('/api/video/projects',{schemaVersion:5,clientCommandId:createId.current,clientCreateId:createId.current});
   idRef.current=created.projectId;rememberProject(created.projectId);
   saveDraft(draftKey(created.projectId),readDraft(key));setProjectId(created.projectId);
   window.history.replaceState(null,'',`/video/${created.projectId}`);
  }
  return idRef.current;
 }

 async function uploadMaterial(file:File):Promise<boolean>{
  if(uploading)return false;
  const mime=/\.md$/i.test(file.name)?'text/markdown':/\.pdf$/i.test(file.name)?'application/pdf':null;
  if(!mime||file.size<1||file.size>(mime==='text/markdown'?1024*1024:20*1024*1024)){setError('请选择不超过 1 MiB 的 .md 或不超过 20 MiB 的 .pdf 文件。');return false}
  setUploading(true);setError('');
  try{
   const id=await ensureProject();
   const reservation=await api<{assetId:string;reservationId:string;uploadUrl:string}>(`/api/video/projects/${id}/assets/reserve`,{
    schemaVersion:5,clientCommandId:crypto.randomUUID(),filename:file.name,declaredBytes:file.size,declaredMime:mime,intendedUse:'reference',rightsConfirmed:true,
   });
   await uploadBytes(reservation.uploadUrl,file,mime);
   const completed=await api<{status:string}>(`/api/video/projects/${id}/assets/${reservation.assetId}/complete`,{schemaVersion:5,clientCommandId:crypto.randomUUID(),reservationId:reservation.reservationId});
   if(!['ready','uploaded'].includes(completed.status))throw Error('资料已上传，但尚未完成解读，请稍后重试。');
   const next=[...readAttachments(id).filter(a=>a.id!==reservation.assetId),{id:reservation.assetId,filename:file.name}];
   saveAttachments(id,next);await refresh();return true;
  }catch(e){setError(e instanceof Error?e.message:'资料上传失败，请重试。');return false}
  finally{setUploading(false)}
 }

 function removeAttachment(id:string){
  if(!idRef.current)return;
  const next=attachments.filter(a=>a.id!==id);saveAttachments(idRef.current,next);
 }

 async function send(retry=false,override?:{text:string;origin?:'canvas'}):Promise<boolean>{
  const retryIntent=retry?pendingMessage:null;
  if(retry&&!retryIntent)return false;
  let text=override?.text??readDraft(key),attachmentIds=override?[]:attachments.map(a=>a.id);
  if(retry&&pendingMessage){text=pendingMessage.request.text;attachmentIds=pendingMessage.request.attachmentIds}
  if((!text.trim()&&!attachmentIds.length)||sendingRef.current||uploading)return false;
  if(attachmentIds.some(id=>!view?.assets.some(asset=>asset.id===id&&asset.status==='ready'))){setError('资料还在读取或读取失败，请等待或移除后发送。');return false}
  sendingRef.current=true;setSending(true);setError('');
  try{
   const id=await ensureProject();
   const command=await messageLock(id,()=>{
    const raw=localStorage.getItem(pendingMessageKey(id)),previous=raw?parseMessageIntent(raw,id):null;
    if(raw&&!previous)throw Error('上一条消息的恢复记录无法读取，请保留草稿并检查浏览器存储。');
    if(retryIntent&&(!previous||previous.request.clientCommandId!==retryIntent.request.clientCommandId||previous.request.clientMessageId!==retryIntent.request.clientMessageId))throw Error('上一条消息的状态已变化，请重新连接。');
    if(previous&&(previous.request.text!==text||JSON.stringify(previous.request.attachmentIds)!==JSON.stringify(attachmentIds)))throw Error('上一条消息还未确认，请先重发上一条。');
    if(previous&&!retry&&!sameTarget(previous.request.target,feedback.target))throw Error('上一条消息还未确认，请先重发上一条。');
    if(!previous&&feedback.stale)throw Error('反馈视频已变化，请重新打开或选择要修改的视频。');
    const intent:MessageIntent=previous??{version:1,projectId:id,...(override?{preserveDraft:true}:{}),request:{schemaVersion:5,clientCommandId:crypto.randomUUID(),clientMessageId:crypto.randomUUID(),text,attachmentIds,target:feedback.target,...(override?.origin?{origin:override.origin}:{})}};
    localStorage.setItem(pendingMessageKey(id),JSON.stringify(intent));return intent;
   });setPendingMessage(command);
   await api(`/api/video/projects/${id}/messages`,command.request);
   const selected=feedbackTarget(view,parseSelection(localStorage.getItem(feedbackKey(id))||'',id));
   if(!command.preserveDraft&&!selected.stale&&sameTarget(selected.target,command.request.target)){
    if(readDraft(key)===text)saveDraft(key,'');
    if(readDraft(draftKey(id))===text)saveDraft(draftKey(id),'');
   }
   const remaining=readAttachments(id).filter(a=>!attachmentIds.includes(a.id));saveAttachments(id,remaining);
   setPendingMessage(await clearMessageIntent(id,command));
   await refresh();return true;
  }catch(e){setError(e instanceof Error?e.message:'连接失败，草稿已保留。');return false}
  finally{sendingRef.current=false;setSending(false)}
 }
 async function stopReply(){const op=view?.activeConversation;if(!projectId||!op)return;try{await api(`/api/video/projects/${projectId}/operations/${op.id}/cancel`,{schemaVersion:5,clientCommandId:crypto.randomUUID(),scope:'reply'});await refresh()}catch(e){setError(e instanceof Error?e.message:'无法停止回复。')}}
 async function generateVideo(current:ProjectView|null=view){
  const view=current;
  if(!projectId||!view||generateBusy.current||!view.actions.some(a=>a.kind==='generate_video'&&a.enabled))return;
  generateBusy.current=true;setGenerating(true);setError('');
  const command=generateCommand.current?.briefVersion===view.briefVersion?generateCommand.current:{briefVersion:view.briefVersion,commandId:crypto.randomUUID()};generateCommand.current=command;
  try{await api(`/api/video/projects/${projectId}/preview`,{schemaVersion:5,clientCommandId:command.commandId,expectedBriefVersion:command.briefVersion});generateCommand.current=undefined;await refresh()}
  catch(e){setError(e instanceof Error?e.message:'生成请求未完成，资料和草稿已保留。');await refresh()}
  finally{generateBusy.current=false;setGenerating(false)}
 }
 /** Quick flow: change the music or redraw one shot, then generate again (unchanged parts are reused). */
 async function updateQuick(change:{music:NonNullable<ProjectView['quick']>['music']}|{redoShotId:string}){
  if(!projectId||generateBusy.current||quickBusy.current)return;quickBusy.current=true;setError('');
  const signature=JSON.stringify({change,briefVersion:view?.briefVersion});
  if(quickIntent.current?.signature!==signature)quickIntent.current={signature,commandId:crypto.randomUUID()};
  try{const next=await api<ProjectView>(`/api/video/projects/${projectId}/quick`,{schemaVersion:5,...change,origin:'canvas',clientCommandId:quickIntent.current.commandId});setView(next);trackCanvasEvent(projectId,{name:'music'in change?'music_changed':'redo_shot',payload:{}});quickIntent.current=null;await generateVideo(next)}
  catch(e){setError(e instanceof Error?e.message:'暂时无法更新，已有视频仍可观看。')}
  finally{quickBusy.current=false}
 }
 const settingsBusy=useRef(false),settingsIntent=useRef<{signature:string;commandId:string}|null>(null);
 async function setPreferences(patch:{durationSec?:number;aspect?:'16:9'|'9:16'}):Promise<boolean>{
  if(!projectId||!view||settingsBusy.current)return false;
  const signature=JSON.stringify({patch,briefVersion:view.briefVersion});
  if(settingsIntent.current?.signature!==signature)settingsIntent.current={signature,commandId:crypto.randomUUID()};
  settingsBusy.current=true;setSending(true);setError('');
  try{const next=await api<ProjectView>(`/api/video/projects/${projectId}/preferences`,{schemaVersion:5,clientCommandId:settingsIntent.current.commandId,expectedBriefVersion:view.briefVersion,patch});setView(old=>old&&old.controlVersion>next.controlVersion?old:next);settingsIntent.current=null;return true}
  catch(e){setError(e instanceof Error?e.message:'规格未保存，原来的设置已保留，请重试。');await refresh();return false}
  finally{settingsBusy.current=false;setSending(false)}
 }
 async function setQuickMusic(music:NonNullable<ProjectView['quick']>['music']):Promise<boolean>{
  if(!projectId||settingsBusy.current)return false;
  const signature=JSON.stringify({music});
  if(settingsIntent.current?.signature!==signature)settingsIntent.current={signature,commandId:crypto.randomUUID()};
  settingsBusy.current=true;setSending(true);setError('');
  try{const next=await api<ProjectView>(`/api/video/projects/${projectId}/quick`,{schemaVersion:5,music,origin:'canvas',clientCommandId:settingsIntent.current.commandId});setView(old=>old&&old.controlVersion>next.controlVersion?old:next);settingsIntent.current=null;trackCanvasEvent(projectId,{name:'music_changed',payload:{}});return true}
  catch(e){setError(e instanceof Error?e.message:'配乐未保存，原来的设置已保留，请重试。');return false}
  finally{settingsBusy.current=false;setSending(false)}
 }
 async function stopProduction(){const op=view?.activeProduction;if(!projectId||!op)return;try{await api(`/api/video/projects/${projectId}/operations/${op.id}/cancel`,{schemaVersion:5,clientCommandId:crypto.randomUUID(),scope:'production'});await refresh()}catch(e){setError(e instanceof Error?e.message:'暂时无法停止，已完成的镜头会保留。')}}
 async function retryScript(){if(!projectId)return;try{await api(`/api/video/projects/${projectId}/script`,{schemaVersion:5});await refresh()}catch(e){setError(e instanceof Error?e.message:'脚本暂时没写好，想法已保留，请重试。')}}
 const messages:Array<Omit<ArchivedMessage,'status'>&{status:ArchivedMessage['status']|'streaming'}>=[...(view?.messages||[]),...stream.messages.filter(s=>!view?.messages.some(m=>m.id===s.id)).map(m=>({...m,status:m.status==='committed'?'completed' as const:m.status,role:'assistant' as const,attachmentIds:[] as string[]}))].sort((a,b)=>a.ordinal-b.ordinal);
 return{projectId,view,draft,setDraft,error,setError,sending,uploading,attachments,uploadMaterial,removeAttachment,send:async()=>{await send()},sendText:(text:string,origin?:'canvas')=>send(false,{text,origin}),setPreferences,setQuickMusic,stopProduction,retryScript,retryPendingMessage:()=>send(true),pendingMessage,feedback,selectFeedback,stopReply,generateVideo:()=>generateVideo(),updateQuick,generating,restoration,projectUpdate,productionActivity:productionStream.activity,messages,connection:stream.connection||productionStream.connection||scriptStream.connection,refresh};
}
