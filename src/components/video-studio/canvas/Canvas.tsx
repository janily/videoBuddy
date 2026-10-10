'use client';
import {useEffect,useRef,useState} from 'react';
import type {ProjectView} from '@/contracts/video/project';
import type {useProject} from '@/hooks/video/use-project';
import {ResultStage} from '../result-stage';
import {StylePicker} from '../style-picker';
import {CardShell} from './CardShell';
import {BriefCard,type BriefSelection} from './BriefCard';
import {StyleCard} from './StyleCard';
import {ScriptCard} from './ScriptCard';
import {ProgressRail} from './ProgressRail';
import {ResultCard} from './ResultCard';
import {deriveCanvasState,type CanvasTarget,type CanvasStage} from './state';
import {trackCanvasEvent} from '@/services/video/analytics/client';
export type CanvasRequest={target:CanvasTarget;shotId?:string;nonce:number;stage?:CanvasStage;focusBase?:CanvasTarget};
export function Canvas({project,onDraft,request}:{project:ReturnType<typeof useProject>;onDraft:(text:string)=>void;request?:CanvasRequest}){
 const view=project.view,state=deriveCanvasState(view),scroll=useRef<HTMLDivElement>(null),lastManual=useRef(0),[newContent,setNewContent]=useState(false),[selection,setSelection]=useState<{patch:BriefSelection;baseVersion:number;baseControlVersion:number;pending:boolean}|null>(null),[failure,setFailure]=useState('');
 const focus=request&&request.stage===state.stage&&request.focusBase===state.focus?request.target:state.focus,lastFocus=useRef(''),newTarget=useRef<CanvasTarget>(focus);
 function go(target:CanvasTarget,shotId?:string){const node=document.getElementById(shotId?`canvas-shot-${shotId}`:`canvas-${target}`);if(node&&scroll.current?.contains(node))node.scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth',block:'nearest'});setNewContent(false)}
 useEffect(()=>{const key=`${state.stage}:${state.focus}`;if(lastFocus.current===key)return;lastFocus.current=key;newTarget.current=state.focus;const timer=setTimeout(()=>{if(Date.now()-lastManual.current<5000)setNewContent(true);else go(state.focus)},0);return()=>clearTimeout(timer)},[state.stage,state.focus]);
 useEffect(()=>{if(!request)return;const timer=setTimeout(()=>go(request.target,request.shotId),30);return()=>clearTimeout(timer)},[request]);
 const analyticsProjectId=view?.projectId;
 useEffect(()=>{if(analyticsProjectId)trackCanvasEvent(analyticsProjectId,{name:'stage_enter',payload:{stage:state.stage}})},[analyticsProjectId,state.stage]);
 useEffect(()=>{
  if(!selection||selection.pending||!view||view.activeConversation||view.controlVersion<=selection.baseControlVersion)return;
  const patch=selection.patch,matches=(!patch.styleSlug||view.preferences.styleSlug===patch.styleSlug)&&(!patch.durationSec||view.preferences.durationSec===patch.durationSec)&&(!patch.aspect||view.preferences.aspect===patch.aspect);
  const timer=setTimeout(()=>{setSelection(null);if(!matches)setFailure('没改成功，原来的选择已保留，再试一次。')},0);return()=>clearTimeout(timer);
 },[selection,view]);
 // Keep the immediate selection until a newer authoritative brief arrives. Failed requests roll back immediately.
 const optimistic=selection&&view&&view.briefVersion===selection.baseVersion?selection.patch:null;
 const shown:ProjectView|null=view?{...view,preferences:{...view.preferences,...(optimistic?.durationSec?{durationSec:optimistic.durationSec}:{}),...(optimistic?.aspect?{aspect:optimistic.aspect}:{}),...(optimistic?.styleSlug?{styleSlug:optimistic.styleSlug}:{})},...(view.quick&&optimistic?.music?{quick:{...view.quick,music:optimistic.music}}:{})}:null;
 async function choose(text:string,patch:BriefSelection){if(!view)return;setFailure('');setSelection({patch,baseVersion:view.briefVersion,baseControlVersion:view.controlVersion,pending:true});const ok=patch.durationSec||patch.aspect?await project.setPreferences(patch):await project.sendText(text,'canvas');if(!ok){setSelection(null);setFailure('没改成功，原来的选择已保留，再试一次。')}else setSelection(old=>old?{...old,pending:false}:null)}
 async function music(next:NonNullable<ProjectView['quick']>['music']){if(!view)return;setSelection({patch:{music:next},baseVersion:view.briefVersion,baseControlVersion:view.controlVersion,pending:true});const ok=await project.setQuickMusic(next);setSelection(null);if(!ok)setFailure('没改成功，原来的配乐已保留，再试一次。')}
 const generate=()=>{if(view)trackCanvasEvent(view.projectId,{name:'generate_clicked',payload:{stage:state.stage}});void project.preparePreview()};
 const busy=project.sending||Boolean(selection?.pending),staged=Boolean(view&&!view.quick);
 if(!shown||state.stage==='S0'&&!staged)return <ResultStage view={null} onExample={onDraft} extra={<StylePicker onSelect={style=>void project.sendText(`画风用「${style.nameZh}」`,'canvas')}/>}/>;
 return <div className="work canvas-work" ref={scroll} aria-label="视频画布" onWheel={()=>lastManual.current=Date.now()} onTouchMove={()=>lastManual.current=Date.now()} onPointerDown={event=>{if(event.target===event.currentTarget)lastManual.current=Date.now()}} onKeyDown={event=>{if(['ArrowDown','ArrowUp','PageDown','PageUp','Home','End',' '].includes(event.key))lastManual.current=Date.now()}}><div className="work-inner canvas-inner"><ol className="flow-steps" aria-label="创作进度">{(['想法','画风','脚本','生成','成片'] as const).map((label,i)=><li className={i===({'S0':0,'S1':0,'S2':1,'S3':2,'S4':3,'S5':4,'S6':4}[state.stage])?'current':''} key={label}><span className="flow-index">{i+1}</span>{label}</li>)}</ol>
 <CardShell target="brief" number={1} title="想法" status={state.briefReady?'已完成':'进行中'} current={focus==='brief'} summary={shown.understanding.subject}><BriefCard view={shown} onDraft={onDraft} onSelect={(text,patch)=>void choose(text,patch)} onMusic={next=>void music(next)} disabled={busy}/></CardShell>
 <CardShell target="style" number={2} title="画风" status={shown.preferences.styleSlug?'已完成':state.briefReady?'需要你选':'待开始'} current={focus==='style'} summary={shown.preferences.styleSlug?`画风已选好，展开后可以换一个`:undefined}><StyleCard view={shown} ready={state.briefReady} disabled={busy} onSelect={(style,fromRecommend)=>{trackCanvasEvent(shown.projectId,{name:'style_selected',payload:{id:style.id,fromRecommend,origin:'canvas'}});void choose(`画风用「${style.nameZh}」`,{styleSlug:style.id})}}/></CardShell>{failure&&<p className="error-box">{failure}</p>}
 {staged?<ResultStage view={shown} onExample={onDraft} onPreview={project.preparePreview} preparing={project.preparingPreview} activity={project.productionActivity?.label} restoration={project.restoration} approval={project.approval} projectUpdate={project.projectUpdate} onSelectFeedback={project.selectFeedback}/>:<><CardShell target="script" number={3} title="脚本" status={state.stale?'需要更新':shown.activeProduction||shown.script?.state==='drafting'?'进行中':shown.script?.state==='ready'?'已完成':'待开始'} current={focus==='script'} summary={shown.script?.summary}><ScriptCard view={shown} onDraft={onDraft} busy={project.preparingPreview} onGenerate={generate} onRetry={()=>void project.retryScript()} onRedo={id=>void project.updateQuick({redoShotId:id})}/></CardShell>{shown.activeProduction&&<ProgressRail activity={project.productionActivity} timingEstimates={shown.timingEstimates} shots={shown.script?.shots.length} onStop={()=>void project.stopProduction()}/>} {shown.productionFailure&&<div className="error-box"><p>{shown.productionFailure.message}</p><button className="text-button" disabled={project.preparingPreview} onClick={generate}>重试生成</button></div>}<CardShell target="result" number={5} title="成片" status={state.stale&&shown.currentResult?'需要更新':shown.currentResult?'已完成':shown.activeProduction?'进行中':'待开始'} current={focus==='result'} summary="视频已做好，可以随时播放和下载"><ResultCard view={shown} onGenerate={generate} onQuick={change=>void project.updateQuick(change)} onSelectFeedback={project.selectFeedback} restoration={project.restoration} busy={project.preparingPreview} stale={state.stale}/></CardShell></>}
 </div>{newContent&&<button className="canvas-new-content" onClick={()=>go(newTarget.current)}>有新内容 ↓</button>}</div>;
}
