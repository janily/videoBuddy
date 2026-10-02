'use client';
import {useCallback,useEffect,useRef,useState}from 'react';
import {ProjectView}from '@/contracts/video/project';
import {draftKey,readDraft,saveDraft,useDraft}from './use-draft';
import {rememberProject} from './recent-projects';
import {useProjectEvents}from './use-project-events';
async function api<T>(path:string,body?:unknown):Promise<T>{const response=await fetch(path,body===undefined?{cache:'no-store'}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const value=await response.json();if(!response.ok)throw Error(value.error?.message||'服务暂时不可用，内容已保留。');return value as T}
async function ensureSession(){const create=()=>api('/api/video/session',{});if(navigator.locks)return navigator.locks.request('vb-session',create);return create()}
export function useProject(initialProjectId?:string){
 const [projectId,setProjectId]=useState(initialProjectId),[view,setView]=useState<ProjectView|null>(null),[error,setError]=useState(''),[sending,setSending]=useState(false);
 const idRef=useRef(initialProjectId),createId=useRef<string|undefined>(undefined),commandRef=useRef<{text:string;commandId:string;messageId:string}|undefined>(undefined);
 const key=draftKey(projectId),[draft,setDraft]=useDraft(key);
 const refresh=useCallback(async()=>{if(!idRef.current)return;try{const next=await api<ProjectView>(`/api/video/projects/${idRef.current}`);rememberProject(next.projectId);setView(old=>old&&old.controlVersion>next.controlVersion?old:next)}catch(e){setError(e instanceof Error?e.message:'无法恢复项目。')}},[]);
 useEffect(()=>{if(initialProjectId){void refresh()}},[initialProjectId,refresh]);
 const stream=useProjectEvents(projectId,view?.activeConversation?.id,view?.activeConversation?.streamEpoch||0,refresh);
 const productionStream=useProjectEvents(projectId,view?.activeProduction?.id,view?.activeProduction?.streamEpoch||0,refresh);
 async function send(){const text=readDraft(key);if(!text.trim()||sending)return;setSending(true);setError('');
  const command=commandRef.current?.text===text?commandRef.current:{text,commandId:crypto.randomUUID(),messageId:crypto.randomUUID()};commandRef.current=command;
  try{
   await ensureSession();
   if(!idRef.current){createId.current ||= crypto.randomUUID();const created=await api<{projectId:string}>('/api/video/projects',{schemaVersion:5,clientCommandId:createId.current,clientCreateId:createId.current});idRef.current=created.projectId;rememberProject(created.projectId);saveDraft(draftKey(created.projectId),readDraft(key));setProjectId(created.projectId)}
   await api(`/api/video/projects/${idRef.current}/messages`,{schemaVersion:5,clientCommandId:command.commandId,clientMessageId:command.messageId,text,attachmentIds:[],target:null});
   if(readDraft(key)===text)saveDraft(key,'');if(readDraft(draftKey(idRef.current))===text)saveDraft(draftKey(idRef.current),'');commandRef.current=undefined;
   await refresh();
  }catch(e){setError(e instanceof Error?e.message:'连接失败，草稿已保留。')}
  finally{if(idRef.current&&idRef.current!==initialProjectId){window.history.replaceState(null,'',`/video/${idRef.current}`)}setSending(false)}
 }
 async function stopReply(){const op=view?.activeConversation;if(!projectId||!op)return;try{await api(`/api/video/projects/${projectId}/operations/${op.id}/cancel`,{schemaVersion:5,clientCommandId:crypto.randomUUID(),scope:'reply'});await refresh()}catch(e){setError(e instanceof Error?e.message:'无法停止回复。')}}
 const messages=[...(view?.messages||[]),...stream.messages.filter(s=>!view?.messages.some(m=>m.id===s.id)).map(m=>({...m,role:'assistant' as const}))].sort((a,b)=>a.ordinal-b.ordinal);
 return{projectId,view,draft,setDraft,error,setError,sending,send,stopReply,messages,connection:stream.connection||productionStream.connection,refresh};
}
