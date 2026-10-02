'use client';
import {useCallback,useSyncExternalStore}from 'react';
export function draftKey(projectId?:string){return`vb-draft:${projectId||'new'}`}
export function readDraft(key:string){try{return localStorage.getItem(key)||''}catch{return''}}
export function saveDraft(key:string,value:string){try{localStorage.setItem(key,value);window.dispatchEvent(new Event('vb-draft'))}catch{}}
export function useDraft(key:string){
 const subscribe=useCallback((notify:()=>void)=>{window.addEventListener('storage',notify);window.addEventListener('vb-draft',notify);return()=>{window.removeEventListener('storage',notify);window.removeEventListener('vb-draft',notify)}},[]);
 const snapshot=useCallback(()=>readDraft(key),[key]);const value=useSyncExternalStore(subscribe,snapshot,()=> '');return[value,(next:string)=>saveDraft(key,next)] as const;
}
