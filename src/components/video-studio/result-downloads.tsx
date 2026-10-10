'use client';
import {useExportDownload} from '@/hooks/video/use-export-download';
import {exportLabels} from '@/services/video/exports/client-contract';
import {Icon} from './icons';
import {useStatusAnnouncement} from './live-status';
const extras=['poster','srt','treatment','credits','quality','source_zip'] as const;
export function ResultDownloads({projectId,artifactId,productionActive,history,videoOnly=false}:{projectId:string;artifactId:string;productionActive:boolean;history?:React.ReactNode;videoOnly?:boolean}){
 const {state,busy,download,reconnect,cancel,connection,activity,downloadError}=useExportDownload(projectId,artifactId,!productionActive);
 const pending=state.phase==='pending'||state.phase==='submitting';
 const locked=busy||pending||state.phase==='uncertain';
 useStatusAnnouncement([state.message||(pending?activity||`正在准备${state.format?exportLabels[state.format]:'下载文件'}…`:''),pending&&productionActive?'任务已保存，制作完成后会接续导出进度。':'',downloadError].filter(Boolean).join('。'));
 return<div className="result-downloads">
  <div className="result-action"><button className="primary-action" disabled={busy} onClick={()=>void download('mp4')}><Icon name="download"/>下载视频</button>
   <details className="preview-script more-downloads"><summary>更多</summary><div className="export-options">{(videoOnly?[]:extras).map(format=><button key={format} className="text-button" disabled={locked} onClick={()=>void download(format)}>下载{exportLabels[format]}</button>)}</div>{history}</details>
  </div>
  <p>{state.message||(pending?activity||`正在准备${state.format?exportLabels[state.format]:'下载文件'}…`:'')}{pending&&productionActive?' 任务已保存，制作完成后会接续导出进度。':''}{pending&&connection?` ${connection}`:''}</p>
  {downloadError&&<p role="alert">{downloadError}</p>}
  {state.phase==='uncertain'&&<button className="text-button" disabled={busy} onClick={()=>void reconnect()}>重新连接下载</button>}
  {state.phase==='pending'&&<button className="text-button" disabled={busy} onClick={()=>void cancel()}>停止导出</button>}
 </div>;
}
