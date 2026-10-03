'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import {z} from 'zod';
import type {ProjectView} from '@/contracts/video/project';
import {parseRestoreIntent,restoreFailure,notifyRestoredResult,type RestoreIntent} from '@/services/video/results/client-contract';
import {useDraft} from './use-draft';
type State={phase:'idle'|'submitting'|'confirmed'|'failed'|'uncertain';message?:string};
const ConfirmationSchema=z.object({projectId:z.uuid(),controlVersion:z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)});
export function useRestoreResult(projectId:string|undefined,refresh:(minimumControlVersion:number)=>Promise<void>){
 const key=`vb-restore:${projectId||'new'}`,[stored]=useDraft(key),[state,setState]=useState<State>({phase:'idle'});
 const intent=useRef<RestoreIntent|null>(null),busy=useRef(false),abort=useRef<AbortController|null>(null);
 useEffect(()=>{const controller=new AbortController();abort.current=controller;return()=>{controller.abort();abort.current=null;intent.current=null;busy.current=false}},[projectId]);
 const clear=useCallback((commandId:string)=>{
  if(parseRestoreIntent(localStorage.getItem(key)||'',projectId)?.request.clientCommandId===commandId)localStorage.removeItem(key);
  window.dispatchEvent(new Event('vb-draft'));intent.current=null;
 },[key,projectId]);
 const submit=useCallback(async(value:RestoreIntent)=>{
  const signal=abort.current?.signal;if(!signal||signal.aborted||busy.current||value.projectId!==projectId)return;
  busy.current=true;intent.current=value;setState({phase:'submitting',message:'正在恢复这个版本…'});
  let acknowledged=false;
  try{
   // A lost acknowledgement can replay only this persisted, explicit command.
   localStorage.setItem(key,JSON.stringify(value));window.dispatchEvent(new Event('vb-draft'));
  }catch{busy.current=false;intent.current=null;setState({phase:'failed',message:'无法保存恢复请求，请检查浏览器存储设置后再试。'});return}
  try{
   const response=await fetch(`/api/video/projects/${projectId}/results/${value.artifactId}/restore`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(value.request),signal});
   const body=await response.json();if(signal.aborted||intent.current?.request.clientCommandId!==value.request.clientCommandId)return;
   if(!response.ok){const code=String(body?.error?.code||'');if(['RESULT_STALE','ARTIFACT_INVALID','VALIDATION_FAILED','ACCESS_NOT_FOUND','PROJECT_EXPIRED','ORIGIN_FORBIDDEN','IDEMPOTENCY_CONFLICT'].includes(code)){clear(value.request.clientCommandId);setState({phase:'failed',message:restoreFailure(code)});await refresh(0).catch(()=>{});return}throw Error('RESTORE_CONNECTION_UNCERTAIN')}
   const confirmation=ConfirmationSchema.parse(body);if(confirmation.projectId!==projectId)throw Error('RESTORE_RESPONSE_INVALID');
   acknowledged=true;notifyRestoredResult(confirmation.projectId,confirmation.controlVersion);await refresh(confirmation.controlVersion);
   if(!signal.aborted&&intent.current?.request.clientCommandId===value.request.clientCommandId){clear(value.request.clientCommandId);setState({phase:'confirmed',message:'恢复请求已确认。'})}
  }catch{if(!signal.aborted&&intent.current?.request.clientCommandId===value.request.clientCommandId)setState({phase:'uncertain',message:acknowledged?'恢复已确认，最新视频暂时无法读取。重新连接会继续同一项请求。':'恢复结果暂时无法确认。重新连接会继续同一项请求。'})}
  finally{if(!signal.aborted)busy.current=false}
 },[projectId,key,clear,refresh]);
 useEffect(()=>{const pending=parseRestoreIntent(stored,projectId);if(pending&&!intent.current)void submit(pending)},[stored,projectId,submit]);
 async function restore(artifactId:string,view:ProjectView|null){
  if(!view||view.projectId!==projectId||view.previousResult?.artifactId!==artifactId||view.phase!=='ready'||view.activeProduction||busy.current||state.phase==='uncertain')return;
  await submit({version:1,projectId:view.projectId,artifactId,request:{schemaVersion:5,clientCommandId:crypto.randomUUID()}});
 }
 async function reconnect(){if(intent.current)await submit(intent.current)}
 return{state,restore,reconnect};
}
