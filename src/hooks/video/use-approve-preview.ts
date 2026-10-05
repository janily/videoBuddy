'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import {z} from 'zod';
import {ApprovePreviewRequestSchema} from '@/contracts/video/commands';
import type {ProjectView} from '@/contracts/video/project';
import {useDraft} from './use-draft';
const IntentSchema=z.strictObject({version:z.literal(1),projectId:z.uuid(),request:ApprovePreviewRequestSchema});
type Intent=z.infer<typeof IntentSchema>;
type State={phase:'idle'|'submitting'|'confirmed'|'failed'|'uncertain';message?:string;previewId?:string};
const ConfirmationSchema=z.object({projectId:z.uuid(),controlVersion:z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)});
function parse(raw:string,projectId?:string){try{const value=IntentSchema.safeParse(JSON.parse(raw));return value.success&&value.data.projectId===projectId?value.data:null}catch{return null}}
export function useApprovePreview(projectId:string|undefined,refresh:(minimumControlVersion:number)=>Promise<void>){
 const key=`vb-approve:${projectId||'new'}`,[stored]=useDraft(key),[state,setState]=useState<State>({phase:'idle'});
 const intent=useRef<Intent|null>(null),busy=useRef(false),abort=useRef<AbortController|null>(null);
 useEffect(()=>{const controller=new AbortController();abort.current=controller;return()=>{controller.abort();abort.current=null;intent.current=null;busy.current=false}},[projectId]);
 const clear=useCallback((id:string)=>{if(parse(localStorage.getItem(key)||'',projectId)?.request.clientCommandId===id)localStorage.removeItem(key);window.dispatchEvent(new Event('vb-draft'));intent.current=null},[key,projectId]);
 const submit=useCallback(async(value:Intent)=>{
  const signal=abort.current?.signal;if(!signal||signal.aborted||busy.current||value.projectId!==projectId)return;
  busy.current=true;intent.current=value;setState({phase:'submitting',message:'正在确认完整视频制作…'});let acknowledged=false;
  try{localStorage.setItem(key,JSON.stringify(value));window.dispatchEvent(new Event('vb-draft'))}catch{busy.current=false;intent.current=null;setState({phase:'failed',message:'无法保存制作请求，请检查浏览器存储后重试。'});return}
  try{
   const response=await fetch(`/api/video/projects/${projectId}/preview/approve`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(value.request),signal}),body=await response.json();
   if(signal.aborted||intent.current?.request.clientCommandId!==value.request.clientCommandId)return;
   if(!response.ok){const code=String(body?.error?.code||'');if(['PREVIEW_STALE','VALIDATION_FAILED','ACCESS_NOT_FOUND','PROJECT_EXPIRED','ORIGIN_FORBIDDEN','IDEMPOTENCY_CONFLICT'].includes(code)){clear(value.request.clientCommandId);setState({phase:'failed',message:code==='PREVIEW_STALE'?'效果已变化，请先看新效果再确认。':'制作请求未通过，请重新读取项目后再试。'});await refresh(0).catch(()=>{});return}throw Error('APPROVAL_UNCERTAIN')}
   const confirmation=ConfirmationSchema.parse(body);if(confirmation.projectId!==projectId)throw Error('APPROVAL_RESPONSE_INVALID');
   acknowledged=true;await refresh(confirmation.controlVersion);
   if(!signal.aborted&&intent.current?.request.clientCommandId===value.request.clientCommandId){clear(value.request.clientCommandId);setState({phase:'confirmed',message:'制作请求已确认。',previewId:value.request.previewId})}
  }catch{if(!signal.aborted&&intent.current?.request.clientCommandId===value.request.clientCommandId)setState({phase:'uncertain',message:acknowledged?'制作已确认，项目状态暂时无法读取。重新连接会继续同一请求。':'制作请求暂时无法确认。重新连接会继续同一请求。'})}
  finally{if(!signal.aborted)busy.current=false}
 },[projectId,key,clear,refresh]);
 useEffect(()=>{const pending=parse(stored,projectId);if(pending&&!intent.current)void submit(pending)},[stored,projectId,submit]);
 async function approve(view:ProjectView|null){
  const preview=view?.currentPreview;if(!view||!preview||view.projectId!==projectId||!view.actions.some(a=>a.kind==='approve_preview'&&a.enabled)||busy.current||state.phase==='uncertain'||state.phase==='confirmed'&&state.previewId===preview.previewId)return;
  if(!navigator.locks){setState({phase:'failed',message:'此浏览器暂不支持安全的制作请求恢复。'});return}
  try{const value=await navigator.locks.request(key,()=>{const raw=localStorage.getItem(key),pending=raw?parse(raw,projectId):null;if(raw&&!pending)throw Error('无法读取上次制作请求，请保留草稿并检查浏览器存储。');const next:Intent=pending||{version:1,projectId:view.projectId,request:{schemaVersion:5,clientCommandId:crypto.randomUUID(),previewId:preview.previewId,revisionId:preview.revisionId,expectedBriefVersion:preview.briefVersion,bundleHash:preview.bundleHash,scriptHash:preview.scriptHash,factsHash:preview.factsHash}};localStorage.setItem(key,JSON.stringify(next));return next});await submit(value)}catch{setState({phase:'failed',message:'无法保存制作请求，请检查浏览器存储后重试。'})}
 }
 async function reconnect(){if(intent.current)await submit(intent.current)}
 return{state,approve,reconnect};
}
