'use client';
import {useState}from 'react';
import Link from 'next/link';
import {RecentProjects} from './recent-projects';
import {StylePicker}from './style-picker';
import {useProject}from '@/hooks/video/use-project';
import {ConversationSidebar}from './conversation-sidebar';
import {ResultStage}from './result-stage';
export function CompanionShell({projectId}:{projectId?:string}){
 const project=useProject(projectId),[tab,setTab]=useState<'chat'|'video'>('chat');
 return<main className="vb-easy"><header className="topbar"><div className="top-left"><Link className="brand" href="/video"><span className="brand-mark">▷</span>VideoBuddy</Link><span className="project-name">{project.view?.title||'边聊边做视频'}</span></div><div className="top-actions"><RecentProjects/><Link className="text-button" href="/video">＋ 新建</Link></div></header><div className="mobile-tabs"><button aria-pressed={tab==='chat'} onClick={()=>setTab('chat')}>聊想法</button><button aria-pressed={tab==='video'} onClick={()=>setTab('video')}>看视频</button></div><div className="shell" data-tab={tab}><ResultStage extra={<StylePicker onSelect={slug=>{project.setDraft(`${project.draft}${project.draft?"\n":""}画风偏好：${slug}`)}}/>} view={project.view} restoration={project.restoration} projectUpdate={project.projectUpdate} preparing={project.preparingPreview} activity={project.productionActivity?.label} onPreview={project.preparePreview} onExample={text=>{project.setDraft(text);setTab('chat')}}/><ConversationSidebar project={project}/></div></main>;
}
