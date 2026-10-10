'use client';
import {useEffect,useRef,useState} from 'react';
export function VideoPlayer({projectId,artifactId,label="视频播放",onSelect,portrait=false}:{projectId:string;artifactId:string;label?:string;onSelect?:()=>void;portrait?:boolean}){
 const [playback,setPlayback]=useState<{artifactId:string;url?:string;error?:string}>();
 const [reload,setReload]=useState(0);
 const videoRef=useRef<HTMLVideoElement>(null),resume=useRef<{time:number;playing:boolean}|null>(null),renewed=useRef(false);
 const progress=useRef({time:0,playing:false});
 function renew(){
  const video=videoRef.current;
  if(video&&!resume.current)resume.current=video.error?{...progress.current}:{time:video.currentTime,playing:!video.paused};
  setReload(n=>n+1);
 }
 useEffect(()=>{
  const abort=new AbortController();
  async function load(){
   try{
    const response=await fetch(`/api/video/projects/${projectId}/artifacts/${artifactId}/access?purpose=play`,{cache:'no-store',signal:abort.signal});const value=await response.json();
    if(!response.ok||typeof value.url!=='string')throw Error('视频暂时无法载入，请重试。');
    if(!abort.signal.aborted)setPlayback({artifactId,url:value.url});
   }catch{if(!abort.signal.aborted)setPlayback(old=>({artifactId,url:old?.artifactId===artifactId?old.url:undefined,error:'视频暂时无法载入，请重试。'}))}
  }
  void load();return()=>abort.abort();
 },[projectId,artifactId,reload]);
 const current=playback?.artifactId===artifactId?playback:undefined;
 return<div className={`preview-player${current?.url?' has-video':''}${portrait?' is-portrait':''}`}>
  {current?.url?<video ref={videoRef} aria-label={label} controls playsInline preload="metadata" src={current.url} onFocus={onSelect} onPointerDown={onSelect} onTimeUpdate={event=>{if(!event.currentTarget.error&&!resume.current)progress.current.time=event.currentTarget.currentTime}} onPlay={()=>{progress.current.playing=true}} onPause={event=>{if(!event.currentTarget.error&&!resume.current)progress.current.playing=false}} onLoadedMetadata={()=>{
   const video=videoRef.current,saved=resume.current;if(!video||!saved)return;
   video.currentTime=Math.min(saved.time,Number.isFinite(video.duration)?video.duration:saved.time);resume.current=null;
   if(saved.playing)void video.play().catch(()=>{setPlayback(old=>old?{...old,error:'点击播放继续观看。'}:old)});else video.pause();
  }} onError={()=>{
   setPlayback(old=>old?{...old,error:'播放连接已失效，请重新载入视频。'}:old);
   if(!renewed.current){renewed.current=true;renew()}
  }}/>:<p className="player-state">{!current?.error&&<span className="spinner" aria-hidden="true"/>}{current?.error||'正在载入视频…'}</p>}
  {current?.url&&current.error&&<p className="player-error">{current.error}</p>}
  {current?.error&&<button className="text-button player-retry" onClick={()=>{onSelect?.();renew()}}>重新载入视频</button>}
 </div>;
}
