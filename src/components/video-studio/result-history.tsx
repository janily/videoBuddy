'use client';
import {useState} from 'react';
import type {ProjectView} from '@/contracts/video/project';
import {PreviewPlayer} from './preview-player';
export function ResultHistory({view,locked,onRestore}:{view:ProjectView;locked:boolean;onRestore:(artifactId:string)=>void}){
 const [show,setShow]=useState(false),previous=view.previousResult;
 if(!previous)return null;
 const canRestore=view.phase==='ready'&&!view.activeProduction&&!locked;
 return<><div className="export-options"><button className="text-button" aria-expanded={show} onClick={()=>setShow(value=>!value)}>{show?'收起上个结果':'查看上个结果'}</button></div>
  {show&&<div><p className="welcome-note">这是上一个结果。</p><PreviewPlayer key={previous.artifactId} projectId={view.projectId} artifactId={previous.artifactId} label="上一个完整视频"/>
   <div className="result-action"><button className="text-button" disabled={!canRestore} onClick={()=>onRestore(previous.artifactId)}>恢复这个版本</button></div>
   {view.activeProduction?<p className="welcome-note">制作完成后可以恢复这个版本。</p>:view.phase!=='ready'?<p className="welcome-note">当前状态暂时不能恢复，已有视频仍可观看。</p>:null}
  </div>}
 </>;
}
