import type {StreamEvent} from '@/contracts/video/commands';
export interface StreamMessage{id:string;text:string;contentVersion:number;ordinal:number;status:'streaming'|'committed'|'stopped'}
export interface StreamState{operationId:string;epoch:number;cursor:number|null;seenIds:string[];messages:Record<string,StreamMessage>;needsCheckpoint:boolean}
export function initialStreamState(operationId:string,epoch:number):StreamState{return{operationId,epoch,cursor:null,seenIds:[],messages:{},needsCheckpoint:false}}
export function reduceEvent(state:StreamState,event:StreamEvent,index:number):StreamState{
 if(event.operationId!==state.operationId||event.epoch<state.epoch)return state;
 if(event.epoch>state.epoch)return{...initialStreamState(state.operationId,event.epoch),needsCheckpoint:true};
 if(state.seenIds.includes(event.eventId)||(state.cursor!==null&&index<=state.cursor))return state;
 if(state.needsCheckpoint)return state;
 if(!Number.isSafeInteger(index)||index<0||(state.cursor!==null&&index>state.cursor+1))return{...state,needsCheckpoint:true};
 const next={...state,messages:{...state.messages},seenIds:[...state.seenIds.slice(-127),event.eventId],cursor:index};
 const payload=event.payload;
 if('messageId'in payload){
  const previous=state.messages[payload.messageId];
  switch(event.type){
   case 'message.started':if(!previous||previous.contentVersion<event.payload.contentVersion)next.messages[event.payload.messageId]={id:event.payload.messageId,text:'',contentVersion:event.payload.contentVersion,ordinal:event.payload.ordinal,status:'streaming'};break;
   case 'message.reset':if(!previous||event.payload.contentVersion>=previous.contentVersion)next.messages[event.payload.messageId]={id:event.payload.messageId,text:event.payload.text,contentVersion:event.payload.contentVersion,ordinal:previous?.ordinal??0,status:'streaming'};break;
   case 'message.delta':{
    const p=event.payload;if(!previous||p.contentVersion>previous.contentVersion)return{...state,needsCheckpoint:true};
    if(p.contentVersion<previous.contentVersion)break;
    if(p.offset===previous.text.length){if(/[\uD800-\uDBFF]$/.test(p.text))return{...state,needsCheckpoint:true};next.messages[p.messageId]={...previous,text:previous.text+p.text}}
    else if(p.offset>previous.text.length||p.offset+p.text.length>previous.text.length||previous.text.slice(p.offset,p.offset+p.text.length)!==p.text)return{...state,needsCheckpoint:true};
    break;
   }
   case 'message.committed':if(previous&&previous.contentVersion===event.payload.contentVersion)next.messages[event.payload.messageId]={...previous,status:'committed'};break;
   case 'message.stopped':if(previous&&previous.contentVersion===event.payload.contentVersion)next.messages[event.payload.messageId]={...previous,status:'stopped'};break;
  }
 }return next;
}
