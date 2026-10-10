'use client';
import {useEffect,useState}from 'react';
import {StreamEventSchema,type StreamEvent}from '@/contracts/video/commands';
import {streamHttpAction} from '@/services/video/stream/reconnect-policy';
import {SseParser,parseCursor}from '@/services/video/stream/sse-parser';
import {initialStreamState,reduceEvent,StreamMessage}from '@/services/video/stream/reducer';
import {refreshesProjectView} from '@/services/video/stream/view-refresh';
export type ProductionActivity=Extract<StreamEvent,{type:'activity.updated'}>['payload']&{operationId:string};
export function useProjectEvents(projectId:string|undefined,operationId:string|undefined,epoch:number,onRefresh:(event?:StreamEvent)=>Promise<void>,recoverConversation=true){
 const[streamed,setStreamed]=useState<StreamMessage[]>([]);const[connection,setConnection]=useState('');
 const[activity,setActivity]=useState<ProductionActivity>();
 useEffect(()=>{
  if(!projectId||!operationId)return;
  const abort=new AbortController();let state=initialStreamState(operationId,epoch),stopped=false,retries=0,startupRetries=0,recoveryRequested=false;
  async function connect(){
   while(!abort.signal.aborted&&!stopped){
    if(!navigator.onLine){setConnection('网络已断开，制作不会因此停止');await new Promise<void>(resolve=>{const resume=()=>{window.removeEventListener('online',resume);resolve()};window.addEventListener('online',resume,{once:true});abort.signal.addEventListener('abort',resume,{once:true})});continue}
    try{
     const cursor=state.cursor!==null?`${state.epoch}:${state.cursor}`:null;
     const response=await fetch(`/api/video/projects/${projectId}/operations/${operationId}/events`,{signal:abort.signal,headers:cursor?{'Last-Event-ID':cursor}:{}});
     if(response.status===409||response.status===410){const error=await response.json().catch(()=>null);if(streamHttpAction(response.status,error?.error?.code)==='refresh_stop'){await onRefresh();stopped=true;break}if(++startupRetries>=3&&!recoveryRequested){recoveryRequested=true;if(recoverConversation)await fetch(`/api/video/projects/${projectId}/recover`,{method:'POST',signal:abort.signal,headers:{'Content-Type':'application/json'},body:JSON.stringify({schemaVersion:5,clientCommandId:crypto.randomUUID()})});await onRefresh()}throw Error('OPERATION_NOT_STARTED')}
     if(!response.ok||!response.body)throw Error('STREAM_UNAVAILABLE');
     setConnection('');retries=0;const reader=response.body.getReader(),parser=new SseParser();
     try{for(;;){const{done,value}=await reader.read();if(done)break;for(const record of parser.push(value)){
      const event=StreamEventSchema.parse(JSON.parse(record.data));if(event.projectId!==projectId||event.operationId!==operationId)throw Error('STREAM_SCOPE_INVALID');const cursor=parseCursor(record.id);const next=reduceEvent(state,event,cursor.index);
      if(next.needsCheckpoint){await onRefresh();stopped=true;break}
      if(next===state)continue;
      state=next;setStreamed(Object.values(state.messages));
      if(event.type==='activity.updated')setActivity({operationId:event.operationId,...event.payload});
      if(event.type==='operation.terminal'&&['failed','interrupted'].includes(event.payload.status))setConnection(event.payload.errorCode==='EFFECT_UNKNOWN'?'上次调用结果尚待核实，资料已保留。':'本次任务未完成，资料和已有内容已保留。');
      if(refreshesProjectView(event.type))await onRefresh(event);
      if(event.type==='operation.terminal')stopped=true;
     }if(stopped)break}}finally{await reader.cancel()}
    }catch{if(abort.signal.aborted)break;setConnection('正在重新连接，制作不会因此停止')}
    if(!stopped)await new Promise(resolve=>{const timer=setTimeout(resolve,Math.min(500*2**retries++,8000)+Math.random()*100);abort.signal.addEventListener('abort',()=>{clearTimeout(timer);resolve(undefined)},{once:true})});
   }
  }
  void connect();return()=>abort.abort();
 },[projectId,operationId,epoch,onRefresh,recoverConversation]);
 return{messages:streamed.filter(m=>m.status==='streaming'),connection,activity:activity?.operationId===operationId?activity:undefined};
}
