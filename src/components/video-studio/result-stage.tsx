'use client';
import type{ProjectView}from '@/contracts/video/project';
import {PreviewPlayer} from './preview-player';
const examples=['给我的咖啡店做一支介绍视频','把这份资料讲成一个小故事','做一段让人看懂的知识科普'];
export function ResultStage({view,onExample,extra,onPreview,preparing=false,activity}:{extra?:React.ReactNode;view:ProjectView|null;onExample:(text:string)=>void;onPreview?:()=>void;preparing?:boolean;activity?:string}){
 if(view?.currentPreview){
  const preview=view.currentPreview,approval=view.actions.find(a=>a.kind==='approve_preview');
  return<section className="work" aria-label="视频结果"><div className="work-inner"><span className="eyebrow">先看一小段，不急着做整片</span><h1 className="result-title">先看看，这个感觉对不对？</h1><p className="intro">播放看看画面和节奏。想调整哪里，继续在右边告诉我。</p>
   {view.productionFailure&&<p role="alert">{view.productionFailure.message}</p>}
   <PreviewPlayer key={preview.previewArtifactId} projectId={view.projectId} artifactId={preview.previewArtifactId}/>
   <p className="welcome-note">效果片段用于确认方向，完整视频还需制作和检查。{preview.state!=='ready'?'当前效果需要更新。':''}</p>
   <p>{preview.summary}</p><details className="preview-script"><summary>看完整文案</summary>{preview.script.map((line,i)=><p key={i}>{line}</p>)}</details>
   {preview.criticalFacts.length>0&&<div className="preview-facts">{preview.criticalFacts.map((fact,i)=><p key={i}>{fact.text}<small> · {fact.source}</small></p>)}</div>}
   <div className="result-action"><p>{view.preferences.durationSec}秒 · {view.preferences.aspect==='16:9'?'横屏':'竖屏'}</p><button className="primary-action" disabled title={approval?.disabledReason}>就按这个做 →</button></div>
   {approval?.disabledReason&&<p className="welcome-note">{approval.disabledReason}</p>}{extra}
   <button className="text-button" disabled={preparing||!view.actions.some(a=>a.kind==='prepare_preview'&&a.enabled)} onClick={onPreview}>{preview.state==='ready'?'重新看效果':'先看新效果'}</button>
  </div></section>;
 }
 if(view?.activeProduction)return<section className="work" aria-label="视频结果"><div className="work-inner"><span className="eyebrow">正在把想法变成画面</span><h1 className="result-title">效果片段正在准备中。</h1><p className="intro" role="status">{activity||'任务已经保存，正在准备效果。'}</p><p className="welcome-note">网络断开不会停止制作。你可以继续在右边聊天。</p>{extra}</div></section>;
 if(view)return<section className="work" aria-label="视频结果"><div className="work-inner"><span className="eyebrow">我们正在一起完善</span><h1 className="result-title">想法，渐渐清楚了。</h1><p className="intro">不用填一张长表单。你继续聊，我来整理。</p>{view.productionFailure&&<p role="alert">{view.productionFailure.message}</p>}<div className="understanding">{view.understanding.summary.map((s,i)=><p key={i}>{s}</p>)}</div><div className="result-action"><p>{view.activeProduction?'正在准备效果，资料和聊天会保留。':'先看效果，再决定做完整视频。'}</p>{view.actions.filter(a=>a.kind==='prepare_preview').map(action=><button key={action.kind} className="primary-action" disabled={!action.enabled||preparing} title={action.disabledReason} onClick={onPreview}>{preparing?'正在提交…':'先看效果 →'}</button>)}</div><p className="welcome-note">{view.preferences.durationSec}秒 · {view.preferences.aspect==='16:9'?'横屏':'竖屏'} · {view.preferences.language==='zh-CN'?'中文':'英文'}</p>{view.actions[0]?.disabledReason&&<p className="welcome-note">{view.actions[0].disabledReason}</p>}{extra}</div></section>;
 return<section className="work" aria-label="视频结果"><div className="work-inner welcome"><span className="welcome-mark">▷</span><span className="eyebrow">一个想法，就可以开始</span><h1>先聊聊，你想做什么视频？</h1><p className="intro">不用先写脚本，也不用一次想清楚。<br/>说说想法，或者发些资料，我们一起慢慢完善。</p><div className="examples">{examples.map(example=><button key={example} onClick={()=>onExample(example)}>{example}<span aria-hidden>↗</span></button>)}</div><p className="welcome-note">先看一小段效果，再决定做完整视频。</p>{extra}</div></section>;
}
