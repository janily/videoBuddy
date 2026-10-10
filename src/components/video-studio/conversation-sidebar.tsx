'use client';
import {useRef,useState,useEffect} from 'react';
import {ChatComposer} from './chat-composer';
import {Icon} from './icons';
import {QuickReplies} from './chat/QuickReplies';
import {LinkedMessage} from './chat/CanvasLink';
import type {CanvasTarget} from './canvas/state';
import {trackCanvasEvent} from '@/services/video/analytics/client';
import type {useProject} from '@/hooks/video/use-project';

const assetFailures:Record<string,string>={PDF_TEXT_UNAVAILABLE:'扫描件没有可读取的文字',PDF_TEXT_LIMIT:'文字过长，暂不能处理',ANALYSIS_TIMEOUT:'读取超时',ASSET_INVALID:'文件无效'};

export function ConversationSidebar({project,onNavigate}:{project:ReturnType<typeof useProject>;onNavigate:(target:CanvasTarget,shotId?:string)=>void}){
 const scroll=useRef<HTMLDivElement>(null),picker=useRef<HTMLInputElement>(null);
 const [following,setFollowing]=useState(true),[readCount,setReadCount]=useState(0),[chosenFile,setChosenFile]=useState<File|null>(null),[rightsChecked,setRightsChecked]=useState(false);
 const newMessages=!following&&project.messages.length>readCount;
 const waiting=project.attachments.some(attachment=>!project.view?.assets.some(asset=>asset.id===attachment.id&&asset.status==='ready'));
 const last=project.messages.at(-1);
 const latestAssistant=project.messages.filter(m=>m.role==='assistant').at(-1);
 const replies=latestAssistant?.ui?.quickReplies||[];
 const pending=project.pendingMessage?.request;
 // The reply is running but no text has streamed in yet: show that the assistant is working.
 const thinking=Boolean(project.view?.activeConversation)&&last?.status!=='streaming';
 useEffect(()=>{const node=scroll.current;if(node&&following)node.scrollTop=node.scrollHeight},[project.messages,following,thinking]);
 return <aside className="conversation" aria-label="创作聊天">
  <div className="chat-heading"><h2><Icon name="chat"/>创作助手</h2><p>边聊边完善，不必一次想清楚。</p></div>
  <div className="chat-messages" ref={scroll} onScroll={()=>{const node=scroll.current;if(node){setFollowing(node.scrollHeight-node.scrollTop-node.clientHeight<80);setReadCount(project.messages.length)}}}>
   {project.messages.length?project.messages.map(message=><div key={message.id} className={`message ${message.role}`}>
    {message.role==='assistant'&&<span className="assistant-label" aria-hidden="true"><span className="assistant-dot"/>VideoBuddy</span>}
    <p><LinkedMessage text={message.text} references={message.ui?.canvasRefs} onNavigate={onNavigate}/></p>
    {message.origin==='canvas'&&<small className="message-origin">通过画布设置</small>}
    {message.ui?.canvasFocus&&<button className="text-button message-canvas-jump" onClick={()=>onNavigate(message.ui!.canvasFocus!)}>在画布上看 ›</button>}
    {message.attachmentIds?.map(id=><small className="message-file" key={id}><Icon name="file"/>{project.view?.assets.find(asset=>asset.id===id)?.filename||'已附资料'}</small>)}
    {message.status==='interrupted'&&<small className="message-note">这轮回复已中断，未保存的文字无法恢复。</small>}
    {message.status==='stopped'&&<small className="message-note">已停止回复</small>}
   </div>):<div className="chat-empty"><p>你想讲什么，讲给谁看？<br/>有资料也可以一起发来。</p></div>}
   {pending?.origin==='canvas'&&!project.messages.some(m=>m.clientMessageId===pending.clientMessageId)&&<div className="message user pending-canvas"><p>{pending.text}</p><small className="message-origin">通过画布设置 · {project.sending?'正在发送':'等待重试'}</small></div>}
   {thinking&&<div className="typing" aria-hidden="true"><span className="typing-dots"><i/><i/><i/></span>正在整理想法</div>}
  </div>
  {newMessages&&<button className="new-message" onClick={()=>{if(scroll.current)scroll.current.scrollTop=scroll.current.scrollHeight;setFollowing(true);setReadCount(project.messages.length)}}>有新消息 ↓</button>}
  <div className="composer-area">
   <p className={`service-status${project.error?' is-error':''}`}>{project.error||project.connection}</p>
   {(project.pendingMessage||project.view?.activeConversation)&&<div className="queue-row">
    {project.pendingMessage&&<button className="text-button" disabled={project.sending||project.uploading} onClick={()=>void project.retryPendingMessage()}><Icon name="refresh"/>重发上一条</button>}
    {project.view?.activeConversation&&<button className="text-button" onClick={()=>void project.stopReply()}><Icon name="stop"/>停止回复</button>}
   </div>}
   <input ref={picker} className="visually-hidden" type="file" accept=".md,.pdf,text/markdown,application/pdf" aria-label="选择资料文件" onChange={event=>{setChosenFile(event.target.files?.[0]||null);setRightsChecked(false);event.target.value=''}}/>
   {chosenFile&&<div className="attachment-choice is-pending"><Icon name="file"/><span>{chosenFile.name}</span><label><input type="checkbox" checked={rightsChecked} onChange={event=>setRightsChecked(event.target.checked)}/>我有权使用这份资料</label><button type="button" className="text-button" disabled={!rightsChecked||project.uploading} onClick={async()=>{if(await project.uploadMaterial(chosenFile)){setChosenFile(null);setRightsChecked(false)}}}>{project.uploading?'正在上传…':'确认并添加'}</button><button type="button" className="icon-button" aria-label="取消选择资料" disabled={project.uploading} onClick={()=>{setChosenFile(null);setRightsChecked(false)}}><Icon name="x"/></button></div>}
   {project.attachments.map(attachment=>{
    const asset=project.view?.assets.find(item=>item.id===attachment.id);
    const failure=(asset?.errorCode&&assetFailures[asset.errorCode])||'读取失败';
    const state=asset?.status==='ready'?'ready':asset?.status==='failed'?'failed':'reading';
    const label=state==='ready'?'已读取，待发送':state==='failed'?`${failure}，请移除或重新选择`:'已上传，正在读取';
    return <div className={`attachment-choice is-${state}`} key={attachment.id}>{state==='reading'?<span className="spinner" aria-hidden="true"/>:<Icon name={state==='ready'?'check':'file'}/>}<span>{attachment.filename} · {label}</span><button className="text-button" aria-label={`移除 ${attachment.filename}`} onClick={()=>project.removeAttachment(attachment.id)}>移除</button></div>;
   })}
   {replies.length>0&&<QuickReplies items={replies} disabled={project.sending||Boolean(project.view?.activeConversation)} onSend={(text,index)=>{if(project.projectId)trackCanvasEvent(project.projectId,{name:'quick_reply_clicked',payload:{index,labelLength:replies[index].label.length}});void project.sendText(text)}}/>}
   <ChatComposer draft={project.draft} onDraft={project.setDraft} onSend={project.send} sending={project.sending||project.uploading} canSend={!waiting&&(!!project.draft.trim()||!!project.attachments.length)} onAttach={()=>picker.current?.click()}/>
   <p className="input-hint">{project.feedback.label?`关于${project.feedback.label}（整片） · `:project.feedback.stale?'反馈视频已变化，请重新选择 · ':''}Enter 发送 · Shift + Enter 换行 · 支持 Markdown 和文本 PDF</p>
  </div>
 </aside>;
}
