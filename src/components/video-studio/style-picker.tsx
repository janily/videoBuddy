'use client';
import {useRef,useState}from 'react';
import {listStyles,searchStyles}from '@/services/video/styles/registry';
export function StylePicker({onSelect}:{onSelect:(slug:string)=>void}){
 const dialog=useRef<HTMLDialogElement>(null),[query,setQuery]=useState(''),[category,setCategory]=useState('');
 const styles=searchStyles(query,category||undefined),categories=[...new Set(listStyles().map(s=>s.categoryZh))];
 return<><button className="text-button style-trigger" onClick={()=>dialog.current?.showModal()}>看看全部画风</button><dialog ref={dialog} className="style-dialog" aria-label="选择画风"><div className="dialog-heading"><h2>找一种适合你的画风</h2><button className="text-button" aria-label="关闭画风选择" onClick={()=>dialog.current?.close()}>✕</button></div><p className="welcome-note">全部 43 种画风保留在制作范围中。真实成片能力正在验证。</p><div className="style-search"><input aria-label="搜索画风" placeholder="搜索中文、英文或风格名" value={query} onChange={e=>setQuery(e.target.value)}/><select aria-label="画风分类" value={category} onChange={e=>setCategory(e.target.value)}><option value="">全部分类</option>{categories.map(c=><option key={c}>{c}</option>)}</select></div><div className="style-grid">{styles.map(s=><button key={s.id} onClick={()=>{onSelect(s.id);dialog.current?.close()}}><strong>{s.nameZh}</strong><span>{s.nameEn}</span><small>{s.technicalReviewFocus}</small><small className="style-capability">{s.capabilityReason}</small></button>)}</div></dialog></>;
}
