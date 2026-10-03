'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import {z} from 'zod';
import {CommandReceiptSchema,type ExportRequest,type StreamEvent} from '@/contracts/video/commands';
import {exportFailure,exportLabels,parseExportIntent,validateDownloadAccess,type ExportIntent} from '@/services/video/exports/client-contract';
import {exportFiles} from '@/services/video/exports/formats';
import {useProjectEvents} from './use-project-events';
import {useDraft} from './use-draft';
type State={phase:'idle'|'submitting'|'pending'|'ready'|'failed'|'uncertain';format?:ExportRequest['format'];operationId?:string;epoch?:number;message?:string};
const OperationSchema=z.object({id:z.string().uuid(),kind:z.literal('export'),status:z.enum(['reserved','running','cancelling','succeeded','failed','cancelled','interrupted','superseded']),streamEpoch:z.number().int().nonnegative()});
const AcceptedSchema=z.object({status:z.literal(202),operationId:z.string().uuid(),receipt:CommandReceiptSchema});
const ReadySchema=z.object({status:z.literal(200),artifactId:z.string().uuid(),access:z.unknown()});
export function useExportDownload(projectId:string,artifactId:string,canFollowSse:boolean){
 const [state,setState]=useState<State>({phase:'idle'}),[busy,setBusy]=useState(false),[downloadError,setDownloadError]=useState('');
 const key=`vb-export:${projectId}:${artifactId}`,[stored]=useDraft(key);
 const activeOperation=useRef<string|undefined>(undefined);
 const intent=useRef<ExportIntent|null>(null),busyRef=useRef(false),abort=useRef<AbortController|null>(null);
 const persist=useCallback((value:ExportIntent)=>{
  // Persist before dispatch; signed access URLs are never part of this record.
  localStorage.setItem(key,JSON.stringify(value));if(intent.current?.request.clientCommandId!==value.request.clientCommandId)activeOperation.current=undefined;intent.current=value;window.dispatchEvent(new Event('vb-draft'));
 },[key]);
 useEffect(()=>{const controller=new AbortController();abort.current=controller;return()=>{controller.abort();abort.current=null;intent.current=null;activeOperation.current=undefined;busyRef.current=false}},[]);
 const inspect=useCallback(async(operationId:string,commandId:string,errorCode?:string)=>{
  const signal=abort.current?.signal;if(!signal||signal.aborted)throw Error('EXPORT_ABORTED');
  const response=await fetch(`/api/video/projects/${projectId}/operations/${operationId}`,{cache:'no-store',signal});
  if(!response.ok)throw Error('EXPORT_CONNECTION_UNCERTAIN');
  const operation=OperationSchema.parse(await response.json());if(signal.aborted)throw Error('EXPORT_ABORTED');if(intent.current?.request.clientCommandId!==commandId||activeOperation.current!==operationId)throw Error('EXPORT_STALE_RESPONSE');if(operation.id!==operationId)throw Error('EXPORT_OPERATION_INVALID');
  if(['failed','cancelled','interrupted','superseded'].includes(operation.status)){
   setState(old=>({...old,phase:'failed',message:operation.status==='cancelled'?'导出已停止，视频仍可下载。':exportFailure(errorCode)}));
  }else if(operation.status!=='succeeded')setState(old=>({...old,phase:'pending',operationId,epoch:operation.streamEpoch,message:undefined}));
  return operation;
 },[projectId]);
 const stopOperation=useCallback(async(value:ExportIntent,operationId:string)=>{
  const signal=abort.current?.signal;if(!signal||signal.aborted)throw Error('EXPORT_ABORTED');
  const response=await fetch(`/api/video/projects/${projectId}/operations/${operationId}/cancel`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({schemaVersion:5,clientCommandId:value.cancelCommandId,scope:'export'}),signal});
  if(!response.ok)throw Error('CANCEL_UNCERTAIN');const operation=await inspect(operationId,value.request.clientCommandId);
  if(operation.status==='succeeded')setState(old=>({...old,phase:'ready',message:'导出已完成，可以下载文件。'}));
  else if(operation.status==='cancelling')setState(old=>({...old,message:'正在停止导出…'}));
  return operation;
 },[projectId,inspect]);
 const submit=useCallback(async(value:ExportIntent,download:boolean)=>{
  const signal=abort.current?.signal;if(!signal||signal.aborted||busyRef.current)return;busyRef.current=true;setBusy(true);
  try{
   if(value.request.format==='mp4')setDownloadError('');
   if(value.request.format!=='mp4'){persist(value);setState({phase:'submitting',format:value.request.format})}
   const response=await fetch(`/api/video/projects/${projectId}/exports`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(value.request),signal});
   const body=await response.json();if(signal.aborted||(value.request.format!=='mp4'&&intent.current?.request.clientCommandId!==value.request.clientCommandId))return;
   if(!response.ok){
    // No replacement command after an uncertain acknowledgement.
    throw Error(body?.error?.code||'EXPORT_CONNECTION_UNCERTAIN');
   }
   if(response.status===200){
    const result=ReadySchema.parse(body),access=validateDownloadAccess(result.access,projectId,result.artifactId,window.location.origin);
    const mime=value.request.format==='mp4'?'video/mp4':value.request.format==='poster'?'image/png':exportFiles[value.request.format].mime;
    if(access.mime!==mime||(value.request.format==='mp4'&&result.artifactId!==artifactId))throw Error('DOWNLOAD_ACCESS_INVALID');
    if(download){const link=document.createElement('a');link.href=access.url;link.download=access.filename;document.body.append(link);link.click();link.remove()}
    if(value.request.format!=='mp4')setState({phase:'ready',format:value.request.format,message:`${exportLabels[value.request.format]}已准备好，点击下载即可保存。`});
   }else if(response.status===202){
    const result=AcceptedSchema.parse(body);
    if(result.receipt.projectId!==projectId||result.receipt.commandId!==value.request.clientCommandId||result.receipt.operationId!==result.operationId)throw Error('EXPORT_OPERATION_INVALID');
    activeOperation.current=result.operationId;setState({phase:'pending',format:value.request.format,operationId:result.operationId,epoch:0});
    let operation=await inspect(result.operationId,value.request.clientCommandId);
    if(value.cancelCommandId&&['reserved','running','cancelling'].includes(operation.status))operation=await stopOperation(value,result.operationId);
    if(operation.status==='succeeded')setState({phase:'ready',format:value.request.format,message:`${exportLabels[value.request.format]}已准备好，点击下载即可保存。`});
   }else throw Error('EXPORT_RESPONSE_INVALID');
  }catch(error){
   if(!signal.aborted&&(value.request.format==='mp4'||intent.current?.request.clientCommandId===value.request.clientCommandId)){
    const code=error instanceof Error?error.message:'';
    const verifiedFailure=['EXPORT_NOT_APPLICABLE','ARCHIVE_ASSET_REDISTRIBUTION_REQUIRED','ARCHIVE_PRIVATE_DATA','RESULT_STALE','EXPORT_FENCED','CAPABILITY_UNAVAILABLE'].includes(code);
    if(value.request.format==='mp4')setDownloadError('视频下载连接暂时不可用，请再次点击下载视频。');
    else setState(old=>({...old,format:old.format||value.request.format,phase:verifiedFailure?'failed':'uncertain',message:verifiedFailure?exportFailure(code):'下载连接暂时不可用。重新连接会继续同一项请求。'}));
   }
  }finally{if(!signal.aborted){busyRef.current=false;setBusy(false)}}
 },[projectId,artifactId,persist,inspect,stopOperation]);
 useEffect(()=>{
  const restored=parseExportIntent(stored,artifactId);
  if(restored&&!intent.current){intent.current=restored;void submit(restored,false)}
 },[stored,artifactId,submit]);
 const refresh=useCallback(async(event?:StreamEvent)=>{
  const signal=abort.current?.signal,current=intent.current;if(!signal||signal.aborted||!current||!state.operationId)return;
  try{
   const operation=await inspect(state.operationId,current.request.clientCommandId,event?.type==='operation.terminal'?event.payload.errorCode:undefined);
   if(operation.status==='succeeded'&&intent.current?.request.clientCommandId===current.request.clientCommandId&&activeOperation.current===state.operationId)setState({phase:'ready',format:current.request.format,message:`${exportLabels[current.request.format]}已准备好，点击下载即可保存。`});
  }catch{if(!signal.aborted&&intent.current?.request.clientCommandId===current.request.clientCommandId&&activeOperation.current===state.operationId)setState(old=>({...old,phase:'uncertain',message:'导出进度暂时无法确认，请重新连接。'}))}
 },[inspect,state.operationId]);
 const events=useProjectEvents(canFollowSse&&state.phase==='pending'?projectId:undefined,state.operationId,state.epoch||0,refresh,false);
 async function download(format:ExportRequest['format']){
  if(busyRef.current)return;
  if(format!=='mp4'&&['pending','submitting','uncertain'].includes(state.phase))return;
  const same=intent.current?.request.format===format&&state.phase==='ready';
  const value:ExportIntent=same?intent.current!:{version:1,request:{schemaVersion:5,clientCommandId:crypto.randomUUID(),artifactId,format}};
  // MP4 does not replace a durable export that is running alongside it.
  await submit(value,true);
 }
 async function reconnect(){if(intent.current)await submit(intent.current,false)}
 async function cancel(){
  const signal=abort.current?.signal;if(!signal||signal.aborted||!intent.current||!state.operationId||busyRef.current)return;
  busyRef.current=true;setBusy(true);
  try{
   const value={...intent.current,cancelCommandId:intent.current.cancelCommandId||crypto.randomUUID()};persist(value);
   await stopOperation(value,state.operationId);
  }catch{if(!signal.aborted)setState(old=>({...old,message:'停止请求尚未确认，请重试。'}))}
  finally{if(!signal.aborted){busyRef.current=false;setBusy(false)}}
 }
 return{state,busy,download,reconnect,cancel,downloadError,connection:events.connection,activity:events.activity?.label};
}
