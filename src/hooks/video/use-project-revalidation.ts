'use client';
import {useEffect,useState} from 'react';
import {ResultNoticeSchema} from '@/services/video/results/client-contract';
export function useProjectRevalidation(projectId:string|undefined,refresh:()=>Promise<void>){
 const [notice,setNotice]=useState<{projectId:string;text:string}|null>(null);
 useEffect(()=>{
  if(!projectId)return;
  let disposed=false;const focused=()=>{if(!disposed)void refresh()},visible=()=>{if(document.visibilityState==='visible')focused()};
  window.addEventListener('focus',focused);document.addEventListener('visibilitychange',visible);
  let channel:BroadcastChannel|undefined;
  try{if(typeof BroadcastChannel!=='undefined'){channel=new BroadcastChannel(`vb-project:${projectId}`);channel.onmessage=event=>{const parsed=ResultNoticeSchema.safeParse(event.data);if(disposed||!parsed.success||parsed.data.projectId!==projectId)return;setNotice({projectId,text:'当前结果有更新。'});void refresh()}}}catch{}
  return()=>{disposed=true;window.removeEventListener('focus',focused);document.removeEventListener('visibilitychange',visible);channel?.close()};
 },[projectId,refresh]);
 return notice&&notice.projectId===projectId?notice.text:'';
}
