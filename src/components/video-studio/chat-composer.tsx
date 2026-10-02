'use client';
import {useRef}from 'react';
export function ChatComposer({draft,onDraft,onSend,sending,canSend,onAttach}:{draft:string;onDraft:(s:string)=>void;onSend:()=>Promise<void>;sending:boolean;canSend:boolean;onAttach:()=>void}){
 const composing=useRef(false);return<div className="composer"><textarea aria-label="说说想法，或发点资料" placeholder="说说想法，或发点资料…" value={draft} onChange={e=>onDraft(e.target.value)} onCompositionStart={()=>composing.current=true} onCompositionEnd={()=>composing.current=false} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey&&!composing.current&&!e.nativeEvent.isComposing){e.preventDefault();void onSend()}}}/><div className="composer-actions"><button className="text-button" onClick={onAttach}>♧ 添加资料</button><button className="send-button" aria-label="发送" disabled={!canSend||sending} onClick={()=>void onSend()}>↑</button></div></div>;
}
