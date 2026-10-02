'use client';
import{useRef,useState}from'react';import Link from'next/link';
import{recentProjectIds}from'@/hooks/video/recent-projects';
interface Recent{projectId:string;title:string;phase:string;expiresAt:string}
export function RecentProjects(){
 const dialog=useRef<HTMLDialogElement>(null),[projects,setProjects]=useState<Recent[]>([]),[error,setError]=useState(''),[loading,setLoading]=useState(false);
 async function open(){dialog.current?.showModal();setLoading(true);setError('');setProjects([]);try{const ids=recentProjectIds();if(!ids.length)return;const response=await fetch('/api/video/projects/lookup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({schemaVersion:5,projectIds:ids})});const value=await response.json();if(!response.ok)throw Error(value.error?.message||'暂时无法读取项目。');setProjects(value.projects)}catch(error){setError(error instanceof Error?error.message:'暂时无法读取项目。')}finally{setLoading(false)}}
 return<><button className="text-button" onClick={()=>void open()}>我的视频</button><dialog ref={dialog} className="style-dialog" aria-labelledby="recent-title"><header><h2 id="recent-title">我的视频</h2><button aria-label="关闭我的视频" onClick={()=>dialog.current?.close()}>×</button></header>{loading?<p role="status">正在读取…</p>:error?<p role="status">{error}</p>:projects.length?<ul>{projects.map(project=><li key={project.projectId}><Link href={`/video/${project.projectId}`}>{project.title}</Link><p>保存至 {new Date(project.expiresAt).toLocaleDateString('zh-CN')}</p></li>)}</ul>:<p>这个浏览器还没有可访问的视频项目。</p>}<p className="welcome-note">这里只记录本浏览器最近打开的项目。清除浏览器数据后无法自动找回。</p></dialog></>;
}
