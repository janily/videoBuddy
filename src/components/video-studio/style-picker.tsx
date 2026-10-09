'use client';
import {useRef,useState}from 'react';
import {listStyles,searchStyles,type StylePack}from '@/services/video/styles/registry';
import {Icon} from './icons';

/** Which styles the server can deliver now; null until known (or when the check fails), then nothing is marked. */
type Availability={profile:'mvp'|'full';ids:Set<string>}|null;

export function StylePicker({onSelect,current}:{onSelect:(style:StylePack)=>void;current?:string|null}){
 const dialog=useRef<HTMLDialogElement>(null),[query,setQuery]=useState(''),[category,setCategory]=useState(''),[availability,setAvailability]=useState<Availability>(null);
 const categories=[...new Set(listStyles().map(s=>s.categoryZh))];
 const ready=(id:string)=>!availability||availability.ids.has(id);
 // Deliverable styles first; otherwise keep catalog order.
 const styles=searchStyles(query,category||undefined).map((style,index)=>({style,index})).sort((a,b)=>Number(ready(b.style.id))-Number(ready(a.style.id))||a.index-b.index).map(item=>item.style);
 const currentStyle=current?listStyles().find(style=>style.id===current):undefined;
 async function open(){
  dialog.current?.showModal();
  if(availability)return;
  try{const response=await fetch('/api/video/styles',{cache:'no-store'});const value=await response.json();if(response.ok&&Array.isArray(value.deliverableStyleIds))setAvailability({profile:value.profile==='mvp'?'mvp':'full',ids:new Set(value.deliverableStyleIds.filter((id:unknown):id is string=>typeof id==='string'))})}catch{/* Without the check every style stays selectable, as before. */}
 }
 return<>
  <button className="text-button style-trigger" onClick={()=>void open()}><Icon name="palette"/>{currentStyle?`画风：${currentStyle.nameZh}`:'看看全部画风'}</button>
  <dialog ref={dialog} className="style-dialog" aria-label="选择画风">
   <div className="dialog-heading"><h2>找一种适合你的画风</h2><button className="icon-button" aria-label="关闭画风选择" onClick={()=>dialog.current?.close()}><Icon name="x"/></button></div>
   <div className="dialog-body">
    <p className="welcome-note">{availability?.profile==='mvp'?'当前版本先支持标记为“现在可做”的画风，其他画风正在接入。选好后会写进对话，由创作助手确认。':'选好后会写进对话，由创作助手确认。'}</p>
    <div className="style-search"><input aria-label="搜索画风" placeholder="搜索中文、英文或风格名" value={query} onChange={e=>setQuery(e.target.value)}/><select aria-label="画风分类" value={category} onChange={e=>setCategory(e.target.value)}><option value="">全部分类</option>{categories.map(c=><option key={c}>{c}</option>)}</select></div>
    {styles.length?<div className="style-grid">{styles.map(s=>{const available=ready(s.id);return<button key={s.id} className="style-card" aria-pressed={s.id===current} onClick={()=>{onSelect(s);dialog.current?.close()}}>
     <span className="style-card-head"><strong>{s.nameZh}</strong>{availability&&(available?<span className="badge badge-ready">现在可做</span>:<span className="badge">即将支持</span>)}</span>
     <span className="style-en">{s.nameEn}</span><small>{s.technicalReviewFocus}</small>
    </button>})}</div>:<p className="empty-note">没有找到这个画风，换个关键词试试。</p>}
   </div>
  </dialog>
 </>;
}
