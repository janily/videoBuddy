'use client';
/* eslint-disable @next/next/no-img-element -- Private or optional sample URLs cannot be optimized publicly. */
import {useEffect,useRef,useState} from 'react';
import {listStyles,type StylePack} from '@/services/video/styles/registry';
import {StyleBrowser} from './canvas/StyleBrowser';
const palette:Record<string,string>={'paper-lantern':'#594335','papercut-red':'#a22b2a','ink-wash':'#697167','blueprint':'#325276','crayon-book':'#b18b61','watercolor':'#839c92','dark-keynote':'#353b49','art-deco':'#806b43'};
/** Real sample media is optional; a labelled colour swatch remains visible when no file exists. */
export function StyleSample({id}:{id:string}){
 const ref=useRef<HTMLDivElement>(null),[visible,setVisible]=useState(false),[imageMissing,setImageMissing]=useState(false),[videoUrl,setVideoUrl]=useState('');
 const style=listStyles().find(s=>s.id===id);
 useEffect(()=>{const node=ref.current;if(!node)return;const observer=new IntersectionObserver(entries=>{if(entries.some(e=>e.isIntersecting)){setVisible(true);observer.disconnect()}},{rootMargin:'80px'});observer.observe(node);return()=>observer.disconnect()},[]);
 useEffect(()=>{if(!visible||matchMedia('(prefers-reduced-motion: reduce)').matches)return;const abort=new AbortController();void fetch(`/style-samples/${id}.mp4`,{method:'HEAD',signal:abort.signal}).then(r=>{if(r.ok&&r.headers.get('content-type')?.startsWith('video/'))setVideoUrl(`/style-samples/${id}.mp4`)}).catch(()=>{});return()=>abort.abort()},[id,visible]);
 return <div ref={ref} className="style-sample-surface" style={{backgroundColor:palette[id]||'#777b71'}}><span>{style?.nameZh||id}</span>{visible&&!imageMissing&&<img className="style-sample" src={`/style-samples/${id}.jpg`} alt={`${style?.nameZh||id}画风样片`} loading="lazy" onError={()=>setImageMissing(true)}/>} {videoUrl&&<video className="style-sample-video" src={videoUrl} preload="none" muted loop playsInline autoPlay onError={()=>setVideoUrl('')} aria-label={`${style?.nameZh||id}画风动态样片`}/>}</div>;
}
/** Compatibility entry point: browsing expands inline and never opens a modal. */
export function StylePicker({onSelect,current}:{onSelect:(style:StylePack)=>void;current?:string|null;hint?:string}){const[open,setOpen]=useState(false);return <div className="inline-style-picker"><button className="text-button" aria-expanded={open} onClick={()=>setOpen(!open)}>看看全部画风</button>{open&&<StyleBrowser current={current} onSelect={style=>{onSelect(style);setOpen(false)}}/>}</div>}
