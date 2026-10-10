'use client';
import {useEffect,useState} from 'react';
import type {ProjectView} from '@/contracts/video/project';
import {listStyles,type StylePack} from '@/services/video/styles/registry';
import {recommendStyles,styleFits} from '@/services/video/styles/recommendations';
import {StyleSample} from '../style-picker';
import {StyleBrowser} from './StyleBrowser';
import {latestCanvasUI} from './state';
import {trackCanvasEvent} from '@/services/video/analytics/client';
export function StyleCard({view,ready,onSelect,disabled}:{view:ProjectView;ready:boolean;onSelect:(style:StylePack,fromRecommend:boolean)=>void;disabled?:boolean}){
 const [change,setChange]=useState(false),[more,setMore]=useState(false),current=listStyles().find(s=>s.id===view.preferences.styleSlug),ui=latestCanvasUI(view),hint=[view.understanding.subject,...view.understanding.summary].join(' ');
 const recommendations=ui?.recommendations?.length?ui.recommendations.map(r=>({style:listStyles().find(s=>s.id===r.styleId),reason:r.reason,primary:r.primary})).filter(r=>r.style):recommendStyles(hint,3).map((style,i)=>({style,reason:styleFits[style.id]?.goodFor||'',primary:i===0}));
 const ids=recommendations.map(r=>r.style!.id).join(',');
 useEffect(()=>{if(ready&&ids)trackCanvasEvent(view.projectId,{name:'style_recommend_shown',payload:{ids:ids.split(',')}})},[ready,ids,view.projectId]);
 if(!ready&&!current)return <p className="canvas-placeholder">聊清楚想法后，这里会推荐适合你的画风。</p>;
 return <>{current&&!change?<div className="style-selected"><StyleSample id={current.id}/><strong>画风：{current.nameZh}</strong><button className="text-button" onClick={()=>setChange(true)}>换一个</button></div>:<><p className="welcome-note">根据「{view.understanding.subject||'你的想法'}」推荐，选一种喜欢的感觉。</p><div className="style-recommendations">{recommendations.map(({style,reason,primary})=>style&&<article className="style-choice" key={style.id}><StyleSample id={style.id}/><strong>{style.nameZh}{primary&&<span className="badge badge-ready">推荐</span>}</strong><small>{reason}</small><button className="secondary-button" aria-label={`用${style.nameZh}`} disabled={disabled} onClick={()=>{onSelect(style,true);setChange(false)}}>用这个</button></article>)}</div><button className="text-button" aria-expanded={more} onClick={()=>setMore(!more)}>{more?'收起更多画风':'看更多画风'} ▾</button>{more&&<StyleBrowser current={current?.id} disabled={disabled} onSelect={style=>{onSelect(style,false);setChange(false)}}/>}</>}{(view.script||view.currentResult)&&change&&<p className="welcome-note">换画风会重新画所有镜头，点击生成后才会开始。</p>}</>;
}
