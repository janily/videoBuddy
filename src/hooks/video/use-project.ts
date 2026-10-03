'use client';
import {useCallback,useEffect,useRef,useState,useSyncExternalStore} from 'react';
import {ProjectView} from '@/contracts/video/project';
import {draftKey,readDraft,saveDraft,useDraft} from './use-draft';
import {rememberProject} from './recent-projects';
import {useProjectEvents} from './use-project-events';
import {useRestoreResult} from './use-restore-result';
import {useProjectRevalidation} from './use-project-revalidation';

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
 const idRef=useRef(initialProjectId),createId=useRef<string|undefined>(undefined),commandRef=useRef<{text:string;attachmentIds:string[];commandId:string;messageId:string}|undefined>(undefined);
 const previewCommand=useRef<{briefVersion:number;commandId:string}|undefined>(undefined),previewBusy=useRef(false);
 const [preparingPreview,setPreparingPreview]=useState(false);
 const key=draftKey(projectId),[draft,setDraft]=useDraft(key);
 const attachmentSnapshot=useCallback(()=>projectId?localStorage.getItem(attachmentKey(projectId))||'[]':'[]',[projectId]);
 const attachments=parseAttachments(useSyncExternalStore(subscribeAttachments,attachmentSnapshot,()=> '[]'));
 const readProject=useCallback(async(minimumControlVersion=0)=>{
  const id=idRef.current;if(!id)throw Error('无法读取项目。');
  const next=await api<ProjectView>(`/api/video/projects/${id}`);
  if(next.projectId!==id||!Number.isSafeInteger(next.controlVersion)||next.controlVersion<minimumControlVersion)throw Error('最新视频暂时无法读取，请重新连接。');
  rememberProject(next.projectId);setView(old=>old&&old.controlVersion>next.controlVersion?old:next);
 },[]);
 const refresh=useCallback(async()=>{if(!idRef.current)return;try{await readProject()}catch(e){setError(e instanceof Error?e.message:'无法恢复项目。')}},[readProject]);
 const restoration=useRestoreResult(projectId,readProject);
 const projectUpdate=useProjectRevalidation(projectId,refresh);
 useEffect(()=>{if(initialProjectId)void readProject().catch(e=>setError(e instanceof Error?e.message:'无法恢复项目。'))},[initialProjectId,readProject]);
 const stream=useProjectEvents(projectId,view?.activeConversation?.id,view?.activeConversation?.streamEpoch||0,refresh);
 const productionStream=useProjectEvents(projectId,view?.activeProduction?.id,view?.activeProduction?.streamEpoch||0,refresh);
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

 async function send(){
  const text=readDraft(key),attachmentIds=attachments.map(a=>a.id);
  if((!text.trim()&&!attachmentIds.length)||sending||uploading)return;
  if(attachmentIds.some(id=>!view?.assets.some(asset=>asset.id===id&&asset.status==='ready'))){setError('资料还在读取或读取失败，请等待或移除后发送。');return}
  setSending(true);setError('');
  const previous=commandRef.current;
  const command=previous?.text===text&&JSON.stringify(previous.attachmentIds)===JSON.stringify(attachmentIds)?previous:{text,attachmentIds,commandId:crypto.randomUUID(),messageId:crypto.randomUUID()};
  commandRef.current=command;
  try{
   const id=await ensureProject();
   await api(`/api/video/projects/${id}/messages`,{schemaVersion:5,clientCommandId:command.commandId,clientMessageId:command.messageId,text,attachmentIds,target:null});
   if(readDraft(key)===text)saveDraft(key,'');
   if(readDraft(draftKey(id))===text)saveDraft(draftKey(id),'');
   const remaining=readAttachments(id).filter(a=>!attachmentIds.includes(a.id));saveAttachments(id,remaining);
   commandRef.current=undefined;
   await refresh();
  }catch(e){setError(e instanceof Error?e.message:'连接失败，草稿已保留。')}
  finally{setSending(false)}
 }
 async function stopReply(){const op=view?.activeConversation;if(!projectId||!op)return;try{await api(`/api/video/projects/${projectId}/operations/${op.id}/cancel`,{schemaVersion:5,clientCommandId:crypto.randomUUID(),scope:'reply'});await refresh()}catch(e){setError(e instanceof Error?e.message:'无法停止回复。')}}
 async function preparePreview(){
  if(!projectId||!view||previewBusy.current||!view.actions.some(a=>a.kind==='prepare_preview'&&a.enabled))return;
  previewBusy.current=true;setPreparingPreview(true);setError('');
  const command=previewCommand.current?.briefVersion===view.briefVersion?previewCommand.current:{briefVersion:view.briefVersion,commandId:crypto.randomUUID()};previewCommand.current=command;
  try{await api(`/api/video/projects/${projectId}/preview`,{schemaVersion:5,clientCommandId:command.commandId,expectedBriefVersion:command.briefVersion});previewCommand.current=undefined;await refresh()}
  catch(e){setError(e instanceof Error?e.message:'效果请求未完成，资料和草稿已保留。');await refresh()}
  finally{previewBusy.current=false;setPreparingPreview(false)}
 }
 const messages=[...(view?.messages||[]),...stream.messages.filter(s=>!view?.messages.some(m=>m.id===s.id)).map(m=>({...m,role:'assistant' as const,attachmentIds:[] as string[]}))].sort((a,b)=>a.ordinal-b.ordinal);
 return{projectId,view,draft,setDraft,error,setError,sending,uploading,attachments,uploadMaterial,removeAttachment,send,stopReply,preparePreview,preparingPreview,restoration,projectUpdate,productionActivity:productionStream.activity,messages,connection:stream.connection||productionStream.connection,refresh};
}
