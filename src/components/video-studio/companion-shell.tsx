'use client';
import {useState}from 'react';
import Link from 'next/link';
import {RecentProjects} from './recent-projects';
import {StylePicker}from './style-picker';
import {useProject}from '@/hooks/video/use-project';
import {ConversationSidebar}from './conversation-sidebar';
import {ResultStage}from './result-stage';
import {Icon} from './icons';
import type {ProjectView} from '@/contracts/video/project';

/** Something on the video side the person has not looked at yet (new preview, new result, a running job). */
function videoSignature(view:ProjectView|null){
 if(!view)return '';
 return [view.currentPreview?.previewArtifactId,view.currentResult?.artifactId,view.activeProduction?.id,view.productionFailure?.operationId].filter(Boolean).join('|');
}
function focusComposer(){requestAnimationFrame(()=>{const input=document.querySelector<HTMLTextAreaElement>('.composer textarea');if(input){input.focus();input.setSelectionRange(input.value.length,input.value.length)}})}

export function CompanionShell({projectId}:{projectId?:string}){
 const project=useProject(projectId),[tab,setTab]=useState<'chat'|'video'>('chat'),[seenVideo,setSeenVideo]=useState('');
 const signature=videoSignature(project.view),unseenVideo=tab==='chat'&&signature!==''&&signature!==seenVideo;
 function show(next:'chat'|'video'){setTab(next);if(next==='video')setSeenVideo(signature)}
 return<main className="vb-easy">
  <header className="topbar">
   <div className="top-left"><Link className="brand" href="/video"><span className="brand-mark"><Icon name="play"/></span>VideoBuddy</Link><span className="project-name" title={project.view?.title}>{project.view?.title||'边聊边做视频'}</span></div>
   <div className="top-actions"><RecentProjects/><Link className="text-button new-project" href="/video"><Icon name="plus"/>新建</Link></div>
  </header>
  <div className="mobile-tabs">
   <button aria-pressed={tab==='chat'} onClick={()=>show('chat')}>聊想法</button>
   <button aria-pressed={tab==='video'} onClick={()=>show('video')}>看视频{unseenVideo&&<span className="mobile-dot" aria-hidden="true"/>}</button>
  </div>
  <div className="shell" data-tab={tab}>
   <ResultStage extra={<StylePicker current={project.view?.preferences.styleSlug} onSelect={style=>{project.setDraft(`${project.draft}${project.draft?"\n":""}画风想用「${style.nameZh}」（${style.id}）`);show('chat');focusComposer()}}/>} view={project.view} onSelectFeedback={project.selectFeedback} restoration={project.restoration} approval={project.approval} projectUpdate={project.projectUpdate} preparing={project.preparingPreview} activity={project.productionActivity?.label} onPreview={project.preparePreview} onExample={text=>{project.setDraft(text);show('chat');focusComposer()}}/>
   <ConversationSidebar project={project}/>
  </div>
 </main>;
}
