'use client';
import {useEffect,useState} from 'react';
import type {ProjectView} from '@/contracts/video/project';
import {PreviewPlayer} from './preview-player';
export function ResultHistory({view,locked,onRestore,onSelectFeedback}:{view:ProjectView;locked:boolean;onRestore:(artifactId:string)=>void;onSelectFeedback?:(artifactId:string,revisionId:string)=>void}){
 const [show,setShow]=useState(false),[confirm,setConfirm]=useState(false),previous=view.previousResult;
 useEffect(()=>{if(!confirm)return;const timer=setTimeout(()=>setConfirm(false),3000);return()=>clearTimeout(timer)},[confirm]);
 if(!previous)return null;
 const canRestore=view.phase==='ready'&&!view.activeProduction&&!locked;
 return <><div className="result-history-strip" aria-label="视频版本"><button aria-pressed={!show} onClick={()=>{setShow(false);if(view.currentResult)onSelectFeedback?.(view.currentResult.artifactId,view.currentResult.revisionId)}}>当前版本</button><button aria-pressed={show} onClick={()=>{const selected=show?view.currentResult:previous;setShow(!show);if(selected)onSelectFeedback?.(selected.artifactId,selected.revisionId)}}>{show?'收起上个结果':'查看上个结果'}</button></div>{show&&<div><p className="welcome-note">这是上一个结果。</p><PreviewPlayer key={previous.artifactId} projectId={view.projectId} artifactId={previous.artifactId} label="上一个完整视频" onSelect={()=>onSelectFeedback?.(previous.artifactId,previous.revisionId)}/><div className="result-action"><button className="text-button" disabled={!canRestore} onClick={()=>{if(confirm){setConfirm(false);onRestore(previous.artifactId)}else setConfirm(true)}}>{confirm?'确定恢复？当前版本会保留':'恢复这个版本'}</button></div>{view.activeProduction?<p className="welcome-note">制作完成后可以恢复这个版本。</p>:view.phase!=='ready'?<p className="welcome-note">当前状态暂时不能恢复，已有视频仍可观看。</p>:null}</div>}</>;
}
