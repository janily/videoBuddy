'use client';
import {useState} from 'react';
import {listStyles,type StylePack} from '@/services/video/styles/registry';
import {styleFits} from '@/services/video/styles/recommendations';
import {StyleSample} from '../style-picker';
export function StyleBrowser({current,onSelect,disabled}:{current?:string|null;onSelect:(style:StylePack)=>void;disabled?:boolean}){
 const [query,setQuery]=useState(''),q=query.trim().toLocaleLowerCase(),styles=listStyles().filter(style=>[style.nameZh,style.nameEn,style.id,styleFits[style.id]?.goodFor||'',styleFits[style.id]?.mood||''].some(text=>text.toLocaleLowerCase().includes(q))),categories=[...new Set(styles.map(s=>s.categoryZh))];
 return <div className="style-browser"><label className="style-browser-search"><span className="visually-hidden">搜索画风</span><input value={query} placeholder="搜索画风或用途，如国风、儿童" onChange={e=>setQuery(e.target.value)}/></label>{categories.map(category=><section key={category}><h3>{category}</h3><div className="style-browser-row">{styles.filter(s=>s.categoryZh===category).map(style=><button key={style.id} className="style-choice" aria-pressed={current===style.id} disabled={disabled} onClick={()=>onSelect(style)}><StyleSample id={style.id}/><strong>{style.nameZh}</strong><small>{styleFits[style.id]?.goodFor}</small><span className="style-use">用这个</span></button>)}</div></section>)}{!styles.length&&<p className="welcome-note">没有找到，换个关键词试试。</p>}</div>;
}
