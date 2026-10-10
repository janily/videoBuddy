'use client';
import {createContext,useCallback,useContext,useEffect,useId,useState} from 'react';
const Notices=createContext<{messages:Record<string,string>;set:(id:string,text:string)=>void}>({messages:{},set:()=>{}});
export function StudioAnnouncements({children}:{children:React.ReactNode}){const[messages,setMessages]=useState<Record<string,string>>({});const set=useCallback((id:string,text:string)=>setMessages(old=>old[id]===text?old:{...old,[id]:text}),[]);return <Notices.Provider value={{messages,set}}>{children}</Notices.Provider>}
export function useStatusAnnouncement(text:string){const id=useId(),{set}=useContext(Notices);useEffect(()=>{set(id,text);return()=>set(id,'')},[id,set,text])}
export function LiveStatus({text}:{text:string}){const{messages}=useContext(Notices);const content=[text,...Object.values(messages)].filter(Boolean).join('。');return <p role="status" aria-live="polite" aria-atomic="true" className="visually-hidden">{content?`工作台状态：${content}`:''}</p>}
