'use client';
import type{ProjectView,QuickResultInfo}from '@/contracts/video/project';
import {listStyles} from '@/services/video/styles/registry';
import {PreviewPlayer} from './preview-player';
import {ResultDownloads} from './result-downloads';
import {ResultHistory} from './result-history';
import {Icon} from './icons';
import {QuickPanel} from './quick-panel';
import type {useApprovePreview} from '@/hooks/video/use-approve-preview';
import type {useRestoreResult} from '@/hooks/video/use-restore-result';
const examples=['给我的咖啡店做一支介绍视频','把这份资料讲成一个小故事','做一段让人看懂的知识科普'];
const steps=['聊想法','看效果','做成片','下载与修改'] as const,quickSteps=['聊想法','生成视频','下载与调整'] as const;

/** Where the project is in the one flow the product offers: talk → preview → approve → download/revise. */
function flowStep(view:ProjectView){
 if(view.phase==='rendering')return 2;
 if(view.currentResult&&!view.currentPreview)return 3;
 if(view.currentResult&&view.phase!=='preview_ready'&&view.phase!=='preparing_preview')return 3;
 if(view.currentPreview||view.phase==='preparing_preview'||view.activeProduction)return 1;
 return 0;
}
function FlowSteps({view}:{view:ProjectView}){
 const quick=Boolean(view.quick),current=quick?view.currentResult&&!view.activeProduction?2:view.activeProduction?1:view.currentResult?2:0:flowStep(view);
 return<ol className="flow-steps" aria-label="制作进度">{(quick?quickSteps:steps).map((label,index)=><li key={label} className={index<current?'done':index===current?'current':undefined} aria-current={index===current?'step':undefined}><span className="flow-index" aria-hidden="true">{index<current?<Icon name="check"/>:index+1}</span>{label}</li>)}</ol>;
}
/** The chat sits on the right on wide screens and behind the 聊想法 tab on phones. */
function Chat(){return<><span className="on-wide">右边</span><span className="on-narrow">「聊想法」里</span></>}
function resultLine(info:QuickResultInfo){
 return [listStyles().find(s=>s.id===info.styleSlug)?.nameZh,`${info.durationSec}秒`,info.aspect==='16:9'?'横屏':'竖屏',info.music?`配乐：${info.music.title}`:'无配乐','含 AI 生成标识'].filter(Boolean).join(' · ');
}
function preferenceLine(view:ProjectView){
 const p=view.preferences,style=p.styleSlug?listStyles().find(s=>s.id===p.styleSlug)?.nameZh:undefined;
 const q=view.quick,sound=q?q.music.mode==='off'?'不要配乐':q.music.mode==='track'?`配乐：${q.tracks.find(t=>t.id===(q.music as {trackId:string}).trackId)?.title||'已选曲目'}`:q.tracks.length?'自动配乐':'无配乐':p.voiceMode==='none'&&p.musicMode==='none'?'无声画面':p.language==='zh-CN'?'中文':'英文';
 return [style,`${p.durationSec}秒`,p.aspect==='16:9'?'横屏':'竖屏',sound].filter(Boolean).join(' · ');
}

export function ResultStage({view,onExample,extra,onPreview,preparing=false,activity,restoration,approval:confirmation,projectUpdate,onSelectFeedback,onQuick}:{onQuick?:(change:Parameters<React.ComponentProps<typeof QuickPanel>['onChange']>[0])=>void;extra?:React.ReactNode;view:ProjectView|null;onExample:(text:string)=>void;onPreview?:()=>void;preparing?:boolean;activity?:string;restoration?:ReturnType<typeof useRestoreResult>;approval?:ReturnType<typeof useApprovePreview>;projectUpdate?:string;onSelectFeedback?:(artifactId:string,revisionId:string)=>void}){
 const confirming=confirmation?.state.phase==='submitting',approvalLocked=confirming||confirmation?.state.phase==='uncertain'||confirmation?.state.phase==='confirmed'&&confirmation.state.previewId===view?.currentPreview?.previewId;
 const confirmationStatus=<>{confirmation?.state.message&&<p className={confirmation.state.phase==='failed'?'error-box':'notice-inline'} role={confirmation.state.phase==='failed'?'alert':'status'} aria-live="polite">{confirmation.state.message}</p>}{confirmation?.state.phase==='uncertain'&&<button className="text-button" onClick={()=>void confirmation.reconnect()}><Icon name="refresh"/>重新连接制作</button>}</>;
 const failure=view?.productionFailure&&<p className="error-box" role="alert">{view.productionFailure.message}</p>;
 const running=(text:string)=><div className="status-row"><span className="spinner" aria-hidden="true"/><p role="status">{text}</p></div>;
 const previewEnabled=Boolean(view?.actions.some(a=>a.kind==='prepare_preview'&&a.enabled)),quick=Boolean(view?.quick);
 if(view?.currentResult&&(!view.currentPreview||view.phase!=='preview_ready')){
  const result=view.currentResult,quickInfo=result.kind==='quick'?result.quick:undefined,portrait=(quickInfo?.aspect||view.preferences.aspect)==='9:16';
  return<section className="work" aria-label="视频结果"><div className="work-inner"><FlowSteps view={view}/><span className="eyebrow">把想法带给更多人</span><h1 className="result-title">视频已经准备好了。</h1><p className="intro">播放看看。想调整哪里，继续在<Chat/>告诉我。</p>
   {projectUpdate&&<p className="notice-inline" role="status" aria-live="polite">{projectUpdate}</p>}{failure}<div className={portrait&&quickInfo&&onQuick?'portrait-layout':undefined}><div className="portrait-media"><PreviewPlayer key={`player:${result.artifactId}`} projectId={view.projectId} artifactId={result.artifactId} label="完整视频" portrait={portrait} onSelect={()=>onSelectFeedback?.(result.artifactId,result.revisionId)}/>
   <p className="media-note">{quickInfo?resultLine(quickInfo):preferenceLine(view)}</p></div>
   {portrait&&quickInfo&&onQuick&&<QuickPanel view={view} info={quickInfo} busy={preparing} onChange={onQuick}/>}</div>
   {view.activeProduction&&running(activity||'新版本正在制作，已有视频仍可观看和下载。')}
   <ResultDownloads key={`downloads:${result.artifactId}`} projectId={view.projectId} artifactId={result.artifactId} productionActive={Boolean(view.activeProduction)} videoOnly={Boolean(quickInfo)} history={restoration&&<ResultHistory view={view} locked={['submitting','uncertain'].includes(restoration.state.phase)} onRestore={artifactId=>void restoration.restore(artifactId,view)} onSelectFeedback={onSelectFeedback}/>}/>
   {restoration?.state.message&&<p className={restoration.state.phase==='failed'?'error-box':'notice-inline'} role={restoration.state.phase==='failed'?'alert':'status'} aria-live="polite">{restoration.state.message}</p>}
   {restoration?.state.phase==='uncertain'&&<button className="text-button" onClick={()=>void restoration.reconnect()}><Icon name="refresh"/>重新连接恢复</button>}{confirmationStatus}
   {!portrait&&quickInfo&&onQuick&&<QuickPanel view={view} info={quickInfo} busy={preparing} onChange={onQuick}/>}
   <div className="secondary-row">{extra}
    {quick?view.actions.some(a=>a.kind==='prepare_preview')&&<button className="secondary-button" disabled={preparing||!previewEnabled} onClick={onPreview}><Icon name="refresh"/>{preparing?'正在提交…':'按最新想法重新生成'}</button>
     :(view.currentPreview?.state!=='ready'||view.phase==='attention')&&view.actions.some(a=>a.kind==='prepare_preview')&&<button className="secondary-button" disabled={preparing||confirming||confirmation?.state.phase==='uncertain'||!previewEnabled} onClick={onPreview}>{preparing?'正在提交…':'先看新效果'}</button>}
   </div>
   {!view.activeProduction&&<p className="postcard"><Icon name="chat"/><span>{quick?<>想改文案、画面或者换个画风？在<Chat/>说清楚，再点“按最新想法重新生成”。</>:<>想改一句文案、换个配乐或者加个标题？直接在<Chat/>说，我会先给你看新效果。</>}</span></p>}
  </div></section>;
 }
 if(view?.currentPreview){
  const preview=view.currentPreview,existingResult=view.currentResult,approvalAction=view.actions.find(a=>a.kind==='approve_preview'),making=view.phase==='rendering'||view.activeProduction?.kind==='render';
  return<section className="work" aria-label="视频结果"><div className="work-inner"><FlowSteps view={view}/>{making?<><span className="eyebrow">已确认，正在制作完整视频</span><h1 className="result-title">完整视频正在制作。</h1><p className="intro">通常需要几分钟，会按确认的效果做成完整视频并检查画面和声音。可以先离开，回来就能看到结果。</p></>:<><span className="eyebrow">先看一小段，不急着做整片</span><h1 className="result-title">先看看，这个感觉对不对？</h1><p className="intro">播放看看画面和节奏。想调整哪里，继续在<Chat/>告诉我。</p></>}
   {failure}
   {view.activeProduction&&running(activity||'完整视频正在制作，任务已经保存。')}
   <PreviewPlayer key={preview.previewArtifactId} projectId={view.projectId} artifactId={preview.previewArtifactId} onSelect={()=>onSelectFeedback?.(preview.previewArtifactId,preview.revisionId)}/>
   <p className="media-note">效果片段用于确认方向，完整视频还需制作和检查。{preview.state!=='ready'?'当前效果需要更新。':''}</p>
   <div className="main-actions"><p className="meta-line">{preferenceLine(view)}</p>{!making&&<button className="primary-action" disabled={!approvalAction?.enabled||!confirmation||approvalLocked} title={approvalAction?.disabledReason} onClick={()=>void confirmation?.approve(view)}>{confirming?'正在确认…':'就按这个做 →'}</button>}</div>
   {approvalAction?.disabledReason&&<p className="welcome-note">{approvalAction.disabledReason}</p>}{confirmationStatus}
   {preview.summary&&<p className="preview-summary">{preview.summary}</p>}
   <details className="preview-script"><summary>看完整文案</summary><div className="script-lines">{preview.script.map((line,i)=><p key={i}>{line}</p>)}</div></details>
   {preview.criticalFacts.length>0&&<div className="preview-facts">{preview.criticalFacts.map((fact,i)=><p key={i}>{fact.text}<small> · {fact.source}</small></p>)}</div>}
   <div className="secondary-row">{extra}<button className="text-button" disabled={preparing||confirming||confirmation?.state.phase==='uncertain'||!previewEnabled} onClick={onPreview}><Icon name="refresh"/>{preview.state==='ready'?'重新看效果':'先看新效果'}</button></div>
   {existingResult&&<details className="existing-result"><summary>查看已有视频</summary><PreviewPlayer projectId={view.projectId} artifactId={existingResult.artifactId} label="已有完整视频" onSelect={()=>onSelectFeedback?.(existingResult.artifactId,existingResult.revisionId)}/><ResultDownloads projectId={view.projectId} artifactId={existingResult.artifactId} productionActive={Boolean(view.activeProduction)}/></details>}
  </div></section>;
 }
 if(view?.activeProduction)return<section className="work" aria-label="视频结果"><div className="work-inner"><FlowSteps view={view}/><span className="eyebrow">正在把想法变成画面</span><h1 className="result-title">{quick?'视频正在生成中。':'效果片段正在准备中。'}</h1>
  <div className="preparing-surface"><span className="spinner" aria-hidden="true"/><p className="intro" role="status">{activity||'任务已经保存，正在准备效果。'}</p><p className="welcome-note">{quick?'会依次构思故事、画每个镜头、渲染、配乐，通常几分钟。':'通常需要几分钟。'}网络断开不会停止制作，你可以继续在<Chat/>聊天。</p></div>{extra}</div></section>;
 if(view){
  const reason=view.actions.find(a=>a.kind==='prepare_preview')?.disabledReason;
  return<section className="work" aria-label="视频结果"><div className="work-inner"><FlowSteps view={view}/><span className="eyebrow">我们正在一起完善</span><h1 className="result-title">想法，渐渐清楚了。</h1><p className="intro">不用填一张长表单。你继续聊，我来整理。</p>{failure}
   <div className="understanding">{view.understanding.summary.length?view.understanding.summary.map((s,i)=><p key={i}>{s}</p>):<p className="understanding-empty">聊过的要点会整理在这里。</p>}</div>
   <div className="result-action"><p>{quick?'聊清楚后直接生成完整视频，不满意再接着改。':'先看效果，再决定做完整视频。'}</p>{view.actions.filter(a=>a.kind==='prepare_preview').map(action=><button key={action.kind} className="primary-action" disabled={!action.enabled||preparing} title={action.disabledReason} onClick={onPreview}>{preparing?'正在提交…':quick?'生成视频 →':'先看效果 →'}</button>)}</div>
   <p className="meta-line">{preferenceLine(view)}</p>{reason&&<p className="hint-line">{reason}</p>}
   <div className="secondary-row">{extra}</div></div></section>;
 }
 return<section className="work" aria-label="视频结果"><div className="work-inner welcome"><span className="welcome-mark"><Icon name="play"/></span><span className="eyebrow">一个想法，就可以开始</span><h1>先聊聊，你想做什么视频？</h1><p className="intro">不用先写脚本，也不用一次想清楚。<br/>说说想法，或者发些资料，我们一起慢慢完善。</p>
  <div className="examples"><span>可以这样开始</span>{examples.map(example=><button key={example} onClick={()=>onExample(example)}>{example}<Icon name="arrow"/></button>)}</div>
  <ol className="how-it-works" aria-label="怎么做">{['聊清楚想讲什么','生成视频看看','不满意就聊着改'].map((text,i)=><li key={text}><span aria-hidden="true">{i+1}</span>{text}</li>)}</ol>
  <div className="secondary-row">{extra}</div></div></section>;
}
