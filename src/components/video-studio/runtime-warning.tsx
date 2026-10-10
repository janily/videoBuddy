'use client';
import {useEffect,useState} from 'react';
import styles from './live-scene-player.module.css';
export function RuntimeWarning({projectId}:{projectId?:string}){
 const [unsafe,setUnsafe]=useState(false);
 useEffect(()=>{const abort=new AbortController();void fetch('/api/video/capabilities',{credentials:'same-origin',cache:'no-store',signal:abort.signal}).then(async response=>{const value=response.ok?await response.json():null;if(!abort.signal.aborted)setUnsafe(value?.unsafeNoSandbox===true)}).catch(()=>{if(!abort.signal.aborted)setUnsafe(false)});return()=>abort.abort()},[projectId]);
 return unsafe?<div className={styles.warning} role="alert">浏览器沙箱已关闭：当前仅供本机调试，请勿处理不可信内容。</div>:null;
}
