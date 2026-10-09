'use client';
import{useRef,useState}from'react';import Link from'next/link';
import{recentProjectIds}from'@/hooks/video/recent-projects';
import{Icon}from'./icons';
interface Recent{projectId:string;title:string;phase:string;expiresAt:string}
const phaseLabels:Record<string,string>={collecting:'正在聊想法',preparing_preview:'正在准备效果',preview_ready:'效果待确认',rendering:'正在制作',ready:'视频已完成',revising:'正在修改',attention:'需要处理',cancelled:'已停止'};
export function RecentProjects(){
 const dialog=useRef<HTMLDialogElement>(null),[projects,setProjects]=useState<Recent[]>([]),[error,setError]=useState(''),[loading,setLoading]=useState(false);
 async function open(){dialog.current?.showModal();setLoading(true);setError('');setProjects([]);try{const ids=recentProjectIds();if(!ids.length)return;const response=await fetch('/api/video/projects/lookup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({schemaVersion:5,projectIds:ids})});const value=await response.json();if(!response.ok)throw Error(value.error?.message||'暂时无法读取项目。');setProjects(value.projects)}catch(error){setError(error instanceof Error?error.message:'暂时无法读取项目。')}finally{setLoading(false)}}
 return<><button className="text-button" onClick={()=>void open()}>我的视频</button><dialog ref={dialog} className="style-dialog recent-dialog" aria-labelledby="recent-title">
  <div className="dialog-heading"><h2 id="recent-title">我的视频</h2><button className="icon-button" aria-label="关闭我的视频" onClick={()=>dialog.current?.close()}><Icon name="x"/></button></div>
  <div className="dialog-body">
   {loading?<p role="status" className="dialog-state"><span className="spinner" aria-hidden="true"/>正在读取…</p>:error?<p role="status" className="dialog-state">{error}</p>:projects.length?<ul className="project-list">{projects.map(project=><li key={project.projectId}><Link className="project-row" href={`/video/${project.projectId}`} onClick={()=>dialog.current?.close()}><span className="project-icon" aria-hidden="true"><Icon name="play"/></span><span className="project-copy"><strong>{project.title}</strong><small>{phaseLabels[project.phase]||'已保存'} · 保存至 {new Date(project.expiresAt).toLocaleDateString('zh-CN')}</small></span><Icon name="chev"/></Link></li>)}</ul>:<p className="dialog-state">这个浏览器还没有可访问的视频项目。</p>}
   <p className="welcome-note">这里只记录本浏览器最近打开的项目。清除浏览器数据后无法自动找回。</p>
  </div>
 </dialog></>;
}
