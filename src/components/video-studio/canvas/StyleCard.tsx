'use client';
import {useEffect} from 'react';
import type {ProjectView} from '@/contracts/video/project';
import {listStyles,type StylePack} from '@/services/video/styles/registry';
import {recommendStyles,styleFits} from '@/services/video/styles/recommendations';
import {StyleSample} from '../style-picker';
import {StyleTile} from './StyleTile';
import {latestCanvasUI} from './state';
import {trackCanvasEvent} from '@/services/video/analytics/client';
export function canvasStyleRecommendations(view:ProjectView|null){
 if(!view||!view.understanding.subject.trim())return [];
 const all=listStyles(),ui=latestCanvasUI(view),local=recommendStyles([view?.understanding.subject,...(view?.understanding.summary||[])].join(' '),3);
 const ids=ui?.recommendations?.map(item=>item.styleId)||local.map(style=>style.id);
 return [...new Set([...ids.filter(id=>all.some(style=>style.id===id)),...all.map(style=>style.id)])].slice(0,3).map((id,i)=>({style:all.find(style=>style.id===id)!,reason:ui?.recommendations?.find(item=>item.styleId===id)?.reason||styleFits[id]?.goodFor.slice(0,30),primary:i===0})).filter(item=>item.style);
}
export function StyleCard({view,ready,onSelect,onOpen,disabled,changing:change,onChange}:{view:ProjectView;ready:boolean;onSelect:(style:StylePack,fromRecommend:boolean)=>void;onOpen:()=>void;disabled?:boolean;changing:boolean;onChange:(value:boolean)=>void}){
 const current=listStyles().find(style=>style.id===view.preferences.styleSlug),base=canvasStyleRecommendations(view),recommendations=current&&!base.some(item=>item.style.id===current.id)?[{style:current,reason:styleFits[current.id]?.goodFor,primary:false},...base.slice(0,2)]:base;
 const ids=base.map(item=>item.style.id).join(',');
 useEffect(()=>{if(ready&&ids)trackCanvasEvent(view.projectId,{name:'style_recommend_shown',payload:{ids:ids.split(',')}})},[ready,ids,view.projectId]);
 if(!ready&&!current)return <p className="canvas-placeholder">聊清楚想法后，这里会推荐适合你的画风。</p>;
 return <div className="style-card-container">{current&&!change?<div className="style-selected"><StyleSample id={current.id}/><div><strong>画风：{current.nameZh}</strong><p>{styleFits[current.id]?.mood} · 适合{styleFits[current.id]?.goodFor}</p></div><button className="text-button" disabled={disabled} onClick={()=>onChange(true)}>换一个</button></div>:<><p className="welcome-note">根据「{view.understanding.subject||'你的想法'}」挑了 3 种，点一下就能选。</p><div className="style-recommendations">{recommendations.map(({style,reason,primary})=><StyleTile key={style.id} style={style} reason={reason} recommended={primary} selected={current?.id===style.id} disabled={disabled} onSelect={()=>{onSelect(style,base.some(item=>item.style.id===style.id))}}/>)}</div><div className="style-more"><span>都不太对？</span><button className="text-button" onClick={onOpen}>浏览全部 {listStyles().length} 种画风 ↗</button></div></>}{disabled&&<p className="welcome-note">正在生成，稍后再换</p>}</div>;
}
