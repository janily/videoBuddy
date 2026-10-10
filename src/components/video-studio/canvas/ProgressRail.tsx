'use client';
import {useEffect,useState} from 'react';
import type {ProjectView} from '@/contracts/video/project';
import {estimateMinutes,productionIndex,productionSteps,type ProductionActivity} from './state';
export function ProgressRail({activity,shots=4,onStop,timingEstimates}:{activity?:ProductionActivity;timingEstimates?:ProjectView['timingEstimates'];shots?:number;onStop:()=>void}){
 const [confirm,setConfirm]=useState(false),index=productionIndex(activity?.stage),total=activity?.total||shots;
 useEffect(()=>{if(!confirm)return;const timer=setTimeout(()=>setConfirm(false),3000);return()=>clearTimeout(timer)},[confirm]);
 const remainingMs=productionSteps.slice(index).reduce((sum,step,i)=>{const observed=timingEstimates?.[step.id];const fallback=step.id==='visual'?total*25000:step.id==='picture'?total*15000:10000;const fraction=i===0&&activity?.total?Math.max(0,1-(activity.completed||0)/activity.total):1;return sum+(observed?.samples?observed.medianMs:fallback)*fraction},0);
 const minutes=timingEstimates&&Object.values(timingEstimates).some(value=>value.samples)?Math.max(1,Math.ceil(remainingMs/60000)):estimateMinutes(activity?.stage,activity?.completed,total);
 return <section className="progress-rail" aria-label="生成进度"><p><strong>正在生成 · 第 {index+1} 步 / 共 5 步</strong><span>约还需 {minutes} 分钟</span></p><ol>{productionSteps.map((step,i)=><li key={step.id} className={i<index?'done':i===index?'current':''} aria-current={i===index?'step':undefined}><span aria-hidden="true">{i<index?'✓':i===index?'●':'○'}</span>{step.label}{i===index&&activity?.total?` ${activity.completed||0}/${activity.total}`:''}</li>)}</ol><p className="welcome-note">{activity?.label||'正在准备，已完成的镜头会逐一显示。'}</p><button className="text-button" onClick={()=>{if(confirm){setConfirm(false);onStop()}else setConfirm(true)}}>{confirm?'确定停止？已画好的镜头会保留':'停止生成'}</button></section>;
}
