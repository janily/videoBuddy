'use client';
import {useRef,useState}from 'react';
import {listStyles,searchStyles,type StylePack}from '@/services/video/styles/registry';
import {recommendStyles,styleFits} from '@/services/video/styles/recommendations';
import {Icon} from './icons';

/** Which styles the server can deliver now; null until known (or when the check fails), then nothing is marked. */
type Availability={profile:'mvp'|'full';ids:Set<string>}|null;

/** Optional sample frame at public/style-samples/<id>.jpg; hidden until one exists. */
export function StyleSample({id}:{id:string}){
 const [missing,setMissing]=useState(false);
 if(missing)return null;
 // eslint-disable-next-line @next/next/no-img-element -- static sample, sized by CSS
 return<img className="style-sample" src={`/style-samples/${id}.jpg`} alt="" loading="lazy" onError={()=>setMissing(true)}/>;
}
export function StylePicker({onSelect,current,hint=''}:{onSelect:(style:StylePack)=>void;current?:string|null;hint?:string}){
 const dialog=useRef<HTMLDialogElement>(null),[query,setQuery]=useState(''),[category,setCategory]=useState(''),[availability,setAvailability]=useState<Availability>(null);
 const all=listStyles(),categories=[...new Set(all.map(s=>s.categoryZh))];
 const ready=(id:string)=>!availability||availability.ids.has(id);
 // Only worth marking when some styles are not available yet.
 const partial=Boolean(availability&&all.some(style=>!availability.ids.has(style.id)));
 const recommended=recommendStyles(hint,3,availability?[...availability.ids]:undefined);
 const browsing=Boolean(query.trim()||category);
 // Search names first, then what a style is good for ("数据", "国风", "儿童").
 const q=query.trim().toLocaleLowerCase(),byName=searchStyles(query,category||undefined),byUse=q?all.filter(style=>(!category||style.categoryZh===category)&&!byName.includes(style)&&[styleFits[style.id]?.goodFor||'',styleFits[style.id]?.mood||'',...(styleFits[style.id]?.keywords||[])].some(text=>text.toLocaleLowerCase().includes(q))):[];
 const styles=[...byName,...byUse].map((style,index)=>({style,index})).sort((a,b)=>Number(ready(b.style.id))-Number(ready(a.style.id))||a.index-b.index).map(item=>item.style);
 const currentStyle=current?all.find(style=>style.id===current):undefined;
 async function open(){
  dialog.current?.showModal();
  if(availability)return;
  try{const response=await fetch('/api/video/styles',{cache:'no-store'});const value=await response.json();if(response.ok&&Array.isArray(value.deliverableStyleIds))setAvailability({profile:value.profile==='mvp'?'mvp':'full',ids:new Set(value.deliverableStyleIds.filter((id:unknown):id is string=>typeof id==='string'))})}catch{/* Without the check every style stays selectable, as before. */}
 }
 function choose(style:StylePack){onSelect(style);dialog.current?.close()}
 const card=(s:StylePack,featured=false)=><button key={s.id} className={`style-card${featured?' is-featured':''}`} aria-pressed={s.id===current} onClick={()=>choose(s)}>
  <StyleSample id={s.id}/>
  <span className="style-card-head"><strong>{s.nameZh}</strong>{partial&&(ready(s.id)?<span className="badge badge-ready">现在可做</span>:<span className="badge">即将支持</span>)}</span>
  <span className="style-en">{s.nameEn} · {s.categoryZh}</span>
  {styleFits[s.id]&&<small>适合：{styleFits[s.id].goodFor}</small>}
  <small className="style-look">{s.technicalReviewFocus}</small>
 </button>;
 return<>
  <button className="text-button style-trigger" onClick={()=>void open()}><Icon name="palette"/>{currentStyle?`画风：${currentStyle.nameZh}`:'看看全部画风'}</button>
  <dialog ref={dialog} className="style-dialog" aria-label="选择画风">
   <div className="dialog-heading"><h2>找一种适合你的画风</h2><button className="icon-button" aria-label="关闭画风选择" onClick={()=>dialog.current?.close()}><Icon name="x"/></button></div>
   <div className="dialog-body">
    <p className="welcome-note">{partial?'当前版本先支持标记为“现在可做”的画风，其他画风正在接入。':''}选好后会写进对话，由创作助手确认；也可以直接告诉助手你想要的感觉，让它来推荐。</p>
    {recommended.length>0&&!browsing&&<section className="style-recommended" aria-label="为你推荐"><h3>根据你聊的内容，推荐这几种</h3><div className="style-grid">{recommended.map(s=>card(s,true))}</div></section>}
    <div className="style-search"><input aria-label="搜索画风" placeholder="搜索中文、英文、风格名或用途，如“数据”“国风”" value={query} onChange={e=>setQuery(e.target.value)}/><select aria-label="画风分类" value={category} onChange={e=>setCategory(e.target.value)}><option value="">全部分类</option>{categories.map(c=><option key={c}>{c}</option>)}</select></div>
    {styles.length?<div className="style-grid">{styles.map(s=>card(s))}</div>:<p className="empty-note">没有找到这个画风，换个关键词试试。</p>}
   </div>
  </dialog>
 </>;
}
