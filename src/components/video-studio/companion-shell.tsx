'use client';
import {useState} from 'react';
import Link from 'next/link';
import {RecentProjects} from './recent-projects';
import {useProject} from '@/hooks/video/use-project';
import {ConversationSidebar} from './conversation-sidebar';
import {Canvas,type CanvasRequest} from './canvas/Canvas';
import {deriveCanvasState,productionIndex,type CanvasTarget} from './canvas/state';
import {Icon} from './icons';
import {StudioAnnouncements,LiveStatus} from './live-status';
export function CompanionShell({projectId}:{projectId?:string}){
 const project=useProject(projectId),[tab,setTab]=useState<'chat'|'video'>('chat'),[seenVideo,setSeenVideo]=useState(''),[request,setRequest]=useState<CanvasRequest>();
 const state=deriveCanvasState(project.view),signature=[state.stage,project.view?.briefVersion,project.view?.script?.state,project.view?.script?.shots.map(s=>s.state).join(','),project.view?.currentResult?.artifactId,project.productionActivity?.label].join('|'),unseenVideo=tab==='chat'&&Boolean(project.view)&&signature!==seenVideo;
 const summary=state.stage==='S2'?'画风推荐好了':state.stage==='S3'?'脚本有新内容':state.stage==='S4'?'镜头正在成形':state.stage==='S5'?'视频做好了':'想法已更新';
 function show(next:'chat'|'video'){setTab(next);if(next==='video'){setSeenVideo(signature);setRequest({target:state.focus,stage:state.stage,focusBase:state.focus,nonce:Date.now()})}}
 function navigate(target:CanvasTarget,shotId?:string){setTab('video');setSeenVideo(signature);setRequest({target,shotId,stage:state.stage,focusBase:state.focus,nonce:Date.now()})}
 function draft(text:string){project.setDraft(text);setTab('chat');requestAnimationFrame(()=>{const input=document.querySelector<HTMLTextAreaElement>('.composer textarea');if(input){input.focus();const blank=text.indexOf('___');input.setSelectionRange(blank<0?text.length:blank,blank<0?text.length:blank+3)}})}
 const completedShot=project.view?.script?.shots.filter(shot=>shot.state==='drawn'||shot.state==='rendered').at(-1);
 const canvasNotice=project.view?.activeProduction&&completedShot?`第 ${(project.view.script?.shots.indexOf(completedShot)||0)+1} 个镜头已画好`:project.view?.currentResult?'视频做好了，可以下载':project.view?.script?.state==='ready'?`脚本已写好，共 ${project.view.script.shots.length} 镜`:'';
 const status=[canvasNotice,project.error||project.connection,project.productionActivity?.label,project.projectUpdate,project.approval.state.message,project.restoration.state.message].filter(Boolean).join('。');
 return <StudioAnnouncements><main className="vb-easy"><header className="topbar"><div className="top-left"><Link className="brand" href="/video"><span className="brand-mark"><Icon name="play"/></span>VideoBuddy</Link><span className="project-name" title={project.view?.title}>{project.view?.title||'边聊边做视频'}</span></div><div className="top-actions"><RecentProjects/><Link className="text-button new-project" href="/video"><Icon name="plus"/>新建</Link></div></header><div className="mobile-tabs"><button aria-pressed={tab==='chat'} onClick={()=>show('chat')}>聊想法</button><button aria-pressed={tab==='video'} onClick={()=>show('video')}>画布{unseenVideo&&<><span className="mobile-dot" aria-hidden="true"/><small className="canvas-update-bubble">{summary}</small></>}</button></div><div className="shell" data-tab={tab}><Canvas project={project} onDraft={draft} request={request}/><div className="conversation-container">{project.view?.activeProduction&&<button className="mobile-progress" onClick={()=>navigate('script')}>正在生成 · 第 {productionIndex(project.productionActivity?.stage)+1} 步 / 共 5 步 · 在画布上看 ›</button>}<ConversationSidebar project={project} onNavigate={navigate}/></div></div><LiveStatus text={status}/></main></StudioAnnouncements>;
}
