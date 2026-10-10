'use client';
import {useRef}from 'react';
import {Icon} from './icons';
export function ChatComposer({draft,onDraft,onSend,sending,canSend,onAttach}:{draft:string;onDraft:(s:string)=>void;onSend:()=>Promise<void>;sending:boolean;canSend:boolean;onAttach:()=>void}){
 const composing=useRef(false);
 return<div className="composer"><textarea className="resize-none" aria-label="说说想法，或发点资料" placeholder="说说想法，或发点资料…" value={draft} onChange={e=>onDraft(e.target.value)} onCompositionStart={()=>composing.current=true} onCompositionEnd={()=>composing.current=false} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey&&!composing.current&&!e.nativeEvent.isComposing){e.preventDefault();void onSend()}}}/>
  <div className="composer-actions"><button className="text-button" onClick={onAttach}><Icon name="paperclip"/>添加资料</button><button className="send-button" aria-label="发送" disabled={!canSend||sending} onClick={()=>void onSend()}>{sending?<span className="spinner spinner-light" aria-hidden="true"/>:<Icon name="up"/>}</button></div>
 </div>;
}
