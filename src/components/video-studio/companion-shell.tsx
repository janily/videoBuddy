'use client';
import { useRef, useState } from 'react';
const examples = ['给我的咖啡店做一支介绍视频', '把这份资料讲成一个小故事', '做一段让人看懂的知识科普'];
export function CompanionShell() {
  const [draft,setDraft] = useState('');
  const [tab,setTab] = useState<'chat'|'video'>('chat');
  const [error,setError] = useState('');
  const [sending,setSending] = useState(false);
  const composing = useRef(false);
  const input = useRef<HTMLTextAreaElement>(null);
  async function send() {
    if (!draft.trim() || sending || composing.current) return;
    setSending(true); setError('');
    try {
      const response = await fetch('/api/video/session',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
      const data = await response.json();
      if (!response.ok) throw new Error(data.error?.message || '服务暂时不可用，请稍后重试。');
      setError('项目服务尚未接通，草稿已保留。');
    } catch (e) { setError(e instanceof Error ? e.message : '连接失败，草稿已保留。'); }
    finally { setSending(false); }
  }
  return <main className="vb-easy">
    <header className="topbar"><div className="top-left"><a className="brand" href="/video"><span className="brand-mark">▷</span>VideoBuddy</a><span className="project-name">边聊边做视频</span></div><div className="top-actions"><button className="text-button" onClick={()=>setError('配置项目存储后，这里会显示本浏览器保存的视频。')}>我的视频</button><button className="text-button" onClick={()=>{setDraft('');setError('');input.current?.focus()}}>＋ 新建</button></div></header>
    <div className="mobile-tabs"><button aria-pressed={tab==='chat'} onClick={()=>setTab('chat')}>聊想法</button><button aria-pressed={tab==='video'} onClick={()=>setTab('video')}>看视频</button></div>
    <div className="shell" data-tab={tab}>
      <section className="work" aria-label="视频结果"><div className="work-inner welcome"><span className="welcome-mark">▷</span><span className="eyebrow">一个想法，就可以开始</span><h1>先聊聊，你想做什么视频？</h1><p className="intro">不用先写脚本，也不用一次想清楚。<br/>说说想法，或者发些资料，我们一起慢慢完善。</p><div className="examples">{examples.map(example=><button key={example} onClick={()=>{setDraft(example);setTab('chat');input.current?.focus()}}>{example}<span aria-hidden>↗</span></button>)}</div><p className="welcome-note">先看一小段效果，再决定做完整视频。</p></div></section>
      <aside className="conversation" aria-label="创作聊天"><div className="chat-heading"><h2>♧ 创作助手</h2><p>边聊边完善，不必一次想清楚。</p></div><div className="chat-messages"><p>你想讲什么，讲给谁看？<br/>有资料也可以一起发来。</p></div><div className="composer-area"><p role="status" className="service-status">{error}</p><div className="composer"><textarea ref={input} aria-label="说说想法，或发点资料" placeholder="说说想法，或发点资料…" value={draft} onChange={e=>setDraft(e.target.value)} onCompositionStart={()=>{composing.current=true}} onCompositionEnd={()=>{composing.current=false}} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey&&!composing.current&&!e.nativeEvent.isComposing){e.preventDefault();void send()}}}/><div className="composer-actions"><button className="text-button" onClick={()=>setError('资料直传尚未配置，暂不能上传。')}>♧ 添加资料</button><button className="send-button" aria-label="发送" disabled={!draft.trim()||sending} onClick={()=>void send()}>↑</button></div></div><p className="input-hint">Enter 发送 · Shift + Enter 换行</p></div></aside>
    </div>
  </main>;
}
