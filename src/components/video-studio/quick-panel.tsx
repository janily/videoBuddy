'use client';
import type {ProjectView,QuickResultInfo} from '@/contracts/video/project';
import {Icon} from './icons';

type Music=NonNullable<ProjectView['quick']>['music'];
type Change={music:Music}|{redoShotId:string};

/** Music and per-shot redraw for a quick-flow film. Each change re-generates only what it affects. */
export function QuickPanel({view,info,busy,onChange,musicOnly=false}:{view:ProjectView;info:QuickResultInfo;busy:boolean;onChange:(change:Change)=>void;musicOnly?:boolean}){
 const quick=view.quick,locked=busy||Boolean(view.activeProduction);
 const value=!quick?'auto':quick.music.mode==='track'?`track:${quick.music.trackId}`:quick.music.mode;
 return<div className="quick-panel">
  <section className="quick-section" aria-label="配乐">
   <div className="quick-heading"><h3>配乐</h3><span>{info.music?`当前：${info.music.title}`:'当前：无配乐'}</span></div>
   {quick&&quick.tracks.length>0?<label className="music-select"><span className="visually-hidden">选择配乐</span>
    <select value={value} disabled={locked} onChange={event=>{const next=event.target.value;onChange({music:next==='auto'?{mode:'auto'}:next==='off'?{mode:'off'}:{mode:'track',trackId:next.slice(6)}})}}>
     <option value="auto">按画风自动挑选</option>
     {quick.tracks.map(track=><option key={track.id} value={`track:${track.id}`}>{track.title}{track.moods.length?` · ${track.moods.slice(0,2).join('、')}`:''}</option>)}
     <option value="off">不要配乐</option>
    </select></label>:<p className="welcome-note">曲库还没有放入音乐，视频暂时没有配乐。</p>}
   {info.music&&<p className="welcome-note">授权：{info.music.license}</p>}
   <p className="welcome-note">换配乐只重新混音，不会重画画面。</p>
  </section>
  {!musicOnly&&<section className="quick-section" aria-label="镜头">
   <div className="quick-heading"><h3>镜头</h3><span>哪一镜不满意，就只重画那一镜</span></div>
   <ol className="shot-list">{info.shots.map((shot,index)=><li key={shot.id}>
    <span className="shot-index" aria-hidden="true">{index+1}</span>
    <span className="shot-copy">{shot.scriptLine||`第 ${index+1} 镜`}{shot.take>0&&<small>已重画 {shot.take} 次</small>}</span>
    <button className="text-button" disabled={locked} onClick={()=>onChange({redoShotId:shot.id})}><Icon name="refresh"/>重画这一镜</button>
   </li>)}</ol>
  </section>}
 </div>;
}
