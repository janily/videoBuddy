'use client';
/* eslint-disable @next/next/no-img-element -- Optional local sample artwork. */
import {createContext,useContext,useEffect,useEffectEvent,useRef,useState} from 'react';
import {styleFits} from '@/services/video/styles/recommendations';
import sampleManifest from '../../../public/style-samples/manifest.json';
import {listStyles} from '@/services/video/styles/registry';
const SampleBudget=createContext<{allow:(id:string)=>boolean}|null>(null);
export function StyleSampleBudget({children}:{children:React.ReactNode}){
 const loaded=useRef(new Set<string>()),root=useRef<HTMLDivElement>(null),[unlimited,setUnlimited]=useState(false);
 useEffect(()=>{const work=root.current?.closest('.work');if(!work)return;const unlock=()=>setUnlimited(true),key=(event:Event)=>{if(event instanceof KeyboardEvent&&['ArrowDown','ArrowUp','PageDown','PageUp','Home','End',' '].includes(event.key))unlock()};work.addEventListener('wheel',unlock,{passive:true});work.addEventListener('touchmove',unlock,{passive:true});work.addEventListener('keydown',key);return()=>{work.removeEventListener('wheel',unlock);work.removeEventListener('touchmove',unlock);work.removeEventListener('keydown',key)}},[]);
 return <SampleBudget.Provider value={{allow:id=>{if(unlimited||loaded.current.has(id)||loaded.current.size<12){loaded.current.add(id);return true}return false}}}><div ref={root}>{children}</div></SampleBudget.Provider>;
}
let playing:HTMLVideoElement|null=null;
/** Load only visible covers; optional loops load on intentional desktop hover. */
export function StyleSample({id}:{id:string}){
 const budget=useContext(SampleBudget);
 const ref=useRef<HTMLDivElement>(null),video=useRef<HTMLVideoElement>(null),[visible,setVisible]=useState(false),[missing,setMissing]=useState(false),[loop,setLoop]=useState(false);
 const clipUrl=sampleManifest.samples.find(item=>item.id===id)?.video as string|null|undefined;
 const style=listStyles().find(item=>item.id===id),[background,foreground,accent]=styleFits[id]?.swatch||['var(--vb-soft)','var(--vb-action)','var(--vb-accent)'];
 useEffect(()=>{const node=ref.current,clip=video.current;if(!node)return;const observer=new IntersectionObserver(entries=>{for(const entry of entries){setVisible(entry.isIntersecting&&(!budget||budget.allow(id)));if(!entry.isIntersecting)video.current?.pause()}},{rootMargin:'0px'});observer.observe(node);return()=>{observer.disconnect();clip?.pause()}},[id,budget]);
 function play(){if(!clipUrl||!matchMedia('(hover: hover) and (pointer: fine)').matches||matchMedia('(prefers-reduced-motion: reduce)').matches)return;setLoop(true);if(playing&&playing!==video.current)playing.pause();if(video.current){playing=video.current;void video.current.play().catch(()=>{})}}
 const onDesktopEnter=useEffectEvent(()=>play());
 useEffect(()=>{const node=ref.current?.closest('.style-tile')||ref.current;if(!node||!clipUrl)return;const start=()=>onDesktopEnter(),stop=()=>video.current?.pause(),motion=matchMedia('(prefers-reduced-motion: reduce)'),change=()=>{if(motion.matches)stop()};node.addEventListener('mouseenter',start);node.addEventListener('mouseleave',stop);motion.addEventListener('change',change);return()=>{node.removeEventListener('mouseenter',start);node.removeEventListener('mouseleave',stop);motion.removeEventListener('change',change)}},[clipUrl]);
 useEffect(()=>{const node=video.current;if(loop&&node){if(playing&&playing!==node)playing.pause();playing=node;void node.play().catch(()=>{})}return()=>{node?.pause();if(playing===node)playing=null}},[loop]);
 return <div ref={ref} className="style-sample-surface" style={{backgroundColor:background,color:foreground}} onMouseEnter={play} onMouseLeave={()=>video.current?.pause()}>
 <svg viewBox="0 0 320 180" aria-hidden="true"><ellipse cx="157" cy="145" rx="78" ry="9" fill={accent} opacity=".3"/><path d="M106 61h91l-9 69q-39 22-73 0z" fill={foreground}/><path d="M197 70q49-1 25 40q-9 12-29 8" fill="none" stroke={accent} strokeWidth="10"/><path d="M127 47q-13-12 0-24M154 47q-13-12 0-24M180 47q-13-12 0-24" fill="none" stroke={accent} strokeWidth="4" strokeLinecap="round"/><path d="M36 154h60m125 0h64" stroke={foreground} strokeWidth="3"/></svg>
 {visible&&!missing&&<img src={`/style-samples/${id}.jpg`} alt={`${style?.nameZh||id}：一杯咖啡样片`} loading="lazy" onError={()=>setMissing(true)}/>}
 {loop&&<video ref={video} className="style-sample-video" src={clipUrl?`/style-samples/${clipUrl}`:undefined} preload="none" muted loop playsInline onError={()=>setLoop(false)} aria-hidden="true"/>}
 </div>;
}
