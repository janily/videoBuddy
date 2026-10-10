'use client';
import {useState} from 'react';
import type {CanvasTarget,CardStatus} from './state';
export function CardShell({target,number,title,status,current,summary,children}:{target:CanvasTarget;number:number;title:string;status:CardStatus;current:boolean;summary?:string;children:React.ReactNode}){
 const [expanded,setExpanded]=useState<boolean|null>(null),complete=status==='已完成',open=expanded??(!complete||current||target==='style');
 return <section id={`canvas-${target}`} className={`canvas-card ${current?'is-current':''} ${status==='需要更新'?'is-stale':''}`} aria-labelledby={`canvas-${target}-title`} aria-current={current?'step':undefined} data-status={status}>
  <header className="canvas-card-heading"><h2 id={`canvas-${target}-title`}><span>{number.toString().padStart(2,'0')}</span>{title}</h2><span className={`canvas-badge ${status==='需要你选'?'needs-choice':''}`}>{status}</span>{complete&&<button className="text-button" aria-label={`${open?'收起':'展开'}${title}`} aria-expanded={open} onClick={()=>setExpanded(!open)}>{open?'收起':'展开'}⌄</button>}</header>
  {!open&&<p className="canvas-summary">{summary||'已整理好，点击展开查看'}</p>}<div className="canvas-card-content" hidden={!open}>{children}</div>
 </section>;
}
