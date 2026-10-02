'use client';
import {useRef,useState,useEffect} from 'react';
import {ChatComposer} from './chat-composer';
import type {useProject} from '@/hooks/video/use-project';

export function ConversationSidebar({project}:{project:ReturnType<typeof useProject>}){
 const scroll=useRef<HTMLDivElement>(null),picker=useRef<HTMLInputElement>(null);
 const [following,setFollowing]=useState(true),[readCount,setReadCount]=useState(0),[chosenFile,setChosenFile]=useState<File|null>(null),[rightsChecked,setRightsChecked]=useState(false);
 const newMessages=!following&&project.messages.length>readCount;
 const waiting=project.attachments.some(attachment=>!project.view?.assets.some(asset=>asset.id===attachment.id&&asset.status==='ready'));
 useEffect(()=>{const node=scroll.current;if(node&&following)node.scrollTop=node.scrollHeight},[project.messages,following]);
 return <aside className="conversation" aria-label="创作聊天">
  <div className="chat-heading"><h2>♧ 创作助手</h2><p>边聊边完善，不必一次想清楚。</p></div>
  <div className="chat-messages" ref={scroll} onScroll={()=>{const node=scroll.current;if(node){setFollowing(node.scrollHeight-node.scrollTop-node.clientHeight<80);setReadCount(project.messages.length)}}}>
   {project.messages.length?project.messages.map(message=><div key={message.id} className={`message ${message.role}`}>
    <p>{message.text}</p>
    {message.attachmentIds?.map(id=><small key={id}>♧ {project.view?.assets.find(asset=>asset.id===id)?.filename||'已附资料'}</small>)}
    {message.status==='interrupted'&&<small>这轮回复已中断，未保存的文字无法恢复。</small>}
    {message.status==='stopped'&&<small>已停止回复</small>}
   </div>):<p>你想讲什么，讲给谁看？<br/>有资料也可以一起发来。</p>}
  </div>
  {newMessages&&<button className="text-button" onClick={()=>{if(scroll.current)scroll.current.scrollTop=scroll.current.scrollHeight;setFollowing(true);setReadCount(project.messages.length)}}>有新消息 ↓</button>}
  <div className="composer-area">
   <p role="status" className="service-status">{project.error||project.connection}</p>
   {project.view?.activeConversation&&<button className="text-button" onClick={()=>void project.stopReply()}>停止回复</button>}
   <input ref={picker} className="visually-hidden" type="file" accept=".md,.pdf,text/markdown,application/pdf" aria-label="选择资料文件" onChange={event=>{setChosenFile(event.target.files?.[0]||null);setRightsChecked(false);event.target.value=''}}/>
   {chosenFile&&<div className="attachment-choice"><span>{chosenFile.name}</span><label><input type="checkbox" checked={rightsChecked} onChange={event=>setRightsChecked(event.target.checked)}/>我有权使用这份资料</label><button type="button" className="text-button" disabled={!rightsChecked||project.uploading} onClick={async()=>{if(await project.uploadMaterial(chosenFile)){setChosenFile(null);setRightsChecked(false)}}}>{project.uploading?'正在上传…':'确认并添加'}</button></div>}
   {project.attachments.map(attachment=>{
    const asset=project.view?.assets.find(item=>item.id===attachment.id);
    const failure=asset?.errorCode==='PDF_TEXT_UNAVAILABLE'?'扫描件没有可读取的文字':asset?.errorCode==='PDF_TEXT_LIMIT'?'文字过长，暂不能处理':asset?.errorCode==='ANALYSIS_TIMEOUT'?'读取超时':asset?.errorCode==='ASSET_INVALID'?'文件无效':'读取失败';
    const label=asset?.status==='ready'?'已读取，待发送':asset?.status==='failed'?`${failure}，请移除或重新选择`:'已上传，正在读取';
    return <div className="attachment-choice" key={attachment.id}><span>♧ {attachment.filename} · {label}</span><button className="text-button" aria-label={`移除 ${attachment.filename}`} onClick={()=>project.removeAttachment(attachment.id)}>移除</button></div>;
   })}
   <ChatComposer draft={project.draft} onDraft={project.setDraft} onSend={project.send} sending={project.sending||project.uploading} canSend={!waiting&&(!!project.draft.trim()||!!project.attachments.length)} onAttach={()=>picker.current?.click()}/>
   <p className="input-hint">Enter 发送 · Shift + Enter 换行 · 支持 Markdown 和文本 PDF</p>
  </div>
 </aside>;
}
