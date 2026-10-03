'use client';
import {useExportDownload} from '@/hooks/video/use-export-download';
import {exportLabels} from '@/services/video/exports/client-contract';
const extras=['srt','treatment','credits','quality','source_zip'] as const;
export function ResultDownloads({projectId,artifactId,productionActive}:{projectId:string;artifactId:string;productionActive:boolean}){
 const {state,busy,download,reconnect,cancel,connection,activity,downloadError}=useExportDownload(projectId,artifactId,!productionActive);
 const pending=state.phase==='pending'||state.phase==='submitting';
 const locked=busy||pending||state.phase==='uncertain';
 return<div className="result-downloads">
  <div className="result-action"><button className="primary-action" disabled={busy} onClick={()=>void download('mp4')}>下载视频</button>
   <details className="preview-script"><summary>更多</summary><div className="export-options">{extras.map(format=><button key={format} className="text-button" disabled={locked} onClick={()=>void download(format)}>下载{exportLabels[format]}</button>)}<button className="text-button" disabled title="封面导出尚未开放">下载封面</button><p className="welcome-note">封面导出尚未开放。</p></div></details>
  </div>
  <p role="status" aria-live="polite">{state.message||(pending?activity||`正在准备${state.format?exportLabels[state.format]:'下载文件'}…`:'')}{pending&&productionActive?' 任务已保存，制作完成后会接续导出进度。':''}{pending&&connection?` ${connection}`:''}</p>
  {downloadError&&<p role="alert">{downloadError}</p>}
  {state.phase==='uncertain'&&<button className="text-button" disabled={busy} onClick={()=>void reconnect()}>重新连接下载</button>}
  {state.phase==='pending'&&<button className="text-button" disabled={busy} onClick={()=>void cancel()}>停止导出</button>}
 </div>;
}
