'use client';
import {useEffect,useRef,useState,type ReactNode} from 'react';
import styles from './live-scene-player.module.css';
type Scene={srcdoc:string;durationSec:number;width:number;height:number};
function validScene(value:unknown):value is Scene{
 if(!value||typeof value!=='object')return false;
 const scene=value as Partial<Scene>;
 return typeof scene.srcdoc==='string'&&scene.srcdoc.length>0&&typeof scene.durationSec==='number'&&Number.isFinite(scene.durationSec)&&scene.durationSec>0&&scene.durationSec<=60&&typeof scene.width==='number'&&Number.isFinite(scene.width)&&scene.width>0&&scene.width<=4096&&typeof scene.height==='number'&&Number.isFinite(scene.height)&&scene.height>0&&scene.height<=4096;
}
/** The authenticated route supplies a self-contained document with its restrictive CSP. */
export function LiveScenePlayer({projectId,operationId,shotId,take,index,fallback}:{projectId:string;operationId:string;shotId:string;take:number;index:number;fallback?:ReactNode}){
 const identity=`${projectId}:${operationId}:${shotId}:${take}`;
 const [result,setResult]=useState<{identity:string;scene?:Scene;error?:boolean}>(),[retry,setRetry]=useState(0);
 useEffect(()=>{const abort=new AbortController();void(async()=>{
  try{const query=new URLSearchParams({operationId,shotId,take:String(take)});const response=await fetch(`/api/video/projects/${encodeURIComponent(projectId)}/scene?${query}`,{credentials:'same-origin',cache:'no-store',signal:abort.signal});const scene:unknown=await response.json();if(!response.ok||!validScene(scene))throw Error('SCENE_UNAVAILABLE');if(!abort.signal.aborted)setResult({identity,scene})}
  catch{if(!abort.signal.aborted)setResult({identity,error:true})}
 })();return()=>abort.abort()},[projectId,operationId,shotId,take,identity,retry]);
 const current=result?.identity===identity?result:undefined;
 return current?.scene?<ScenePlayback key={identity} scene={current.scene} index={index}/>:<div>{fallback}{current?.error?<><p className={styles.note}>实时预览暂时无法载入，已画好的镜头仍会继续生成。</p><button className="text-button" onClick={()=>setRetry(value=>value+1)}>重试第 {index+1} 镜预览</button></>:<p className={styles.note}>正在载入实时预览…</p>}</div>;
}
function ScenePlayback({scene,index}:{scene:Scene;index:number}){
 const frame=useRef<HTMLIFrameElement>(null),viewport=useRef<HTMLDivElement>(null),clock=useRef(0);
 const [scale,setScale]=useState(1),[loaded,setLoaded]=useState(false),[playing,setPlaying]=useState(false),[time,setTime]=useState(0);
 function seek(next:number){const bounded=Math.min(scene.durationSec,Math.max(0,next));clock.current=bounded;setTime(bounded);frame.current?.contentWindow?.postMessage({type:'videobuddy:time',timeSec:bounded},'*')}
 useEffect(()=>{const element=viewport.current;if(!element)return;const observer=new ResizeObserver(entries=>{const width=entries[0]?.contentRect.width;if(width)setScale(width/scene.width)});observer.observe(element);return()=>observer.disconnect()},[scene.width]);
 useEffect(()=>{if(!playing||!loaded)return;let animation=0,last=performance.now();function tick(now:number){const next=Math.min(scene.durationSec,clock.current+(now-last)/1000);last=now;clock.current=next;setTime(next);frame.current?.contentWindow?.postMessage({type:'videobuddy:time',timeSec:next},'*');if(next>=scene.durationSec)setPlaying(false);else animation=requestAnimationFrame(tick)}animation=requestAnimationFrame(tick);return()=>cancelAnimationFrame(animation)},[playing,loaded,scene.durationSec]);
 return <div className={styles.player}><div ref={viewport} className={styles.viewport} style={{aspectRatio:`${scene.width}/${scene.height}`}}><iframe ref={frame} title={`第 ${index+1} 镜实时预览`} sandbox="allow-scripts" referrerPolicy="no-referrer" tabIndex={-1} srcDoc={scene.srcdoc} style={{width:scene.width,height:scene.height,transform:`scale(${scale})`}} onLoad={()=>{setLoaded(true);seek(0)}}/></div><div className={styles.controls}><button className="text-button" disabled={!loaded} aria-label={`${playing?'暂停':'播放'}第 ${index+1} 镜预览`} onClick={()=>{if(!playing&&clock.current>=scene.durationSec)seek(0);setPlaying(value=>!value)}}>{playing?'暂停':'播放'}</button><input type="range" min={0} max={scene.durationSec} step={0.01} value={time} disabled={!loaded} aria-label={`第 ${index+1} 镜预览进度`} aria-valuetext={`${time.toFixed(1)} 秒，共 ${scene.durationSec.toFixed(1)} 秒`} onChange={event=>seek(Number(event.target.value))}/><span className={styles.time}>{time.toFixed(1)} / {scene.durationSec.toFixed(1)} 秒</span></div><p className={styles.note}>实时预览，最终画面以成片为准。</p></div>;
}
