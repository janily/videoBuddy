'use client';
import type {CanvasTarget} from '../canvas/state';
export type CanvasReference={text:string;target:CanvasTarget;shotId?:string};
export function CanvasLink({reference,onNavigate}:{reference:CanvasReference;onNavigate:(target:CanvasTarget,shotId?:string)=>void}){return <button className="canvas-link" onClick={()=>onNavigate(reference.target,reference.shotId)}>{reference.text} ↗</button>}
export function LinkedMessage({text,references=[],onNavigate}:{text:string;references?:CanvasReference[];onNavigate:(target:CanvasTarget,shotId?:string)=>void}){
 const valid=references.map(reference=>({reference,start:text.indexOf(reference.text)})).filter(r=>r.start>=0&&r.reference.text).sort((a,b)=>a.start-b.start),parts:React.ReactNode[]=[];let cursor=0;
 for(const {reference,start} of valid){if(start<cursor)continue;parts.push(text.slice(cursor,start),<CanvasLink key={`${start}:${reference.text}`} reference={reference} onNavigate={onNavigate}/>);cursor=start+reference.text.length}parts.push(text.slice(cursor));return <>{parts}</>;
}
