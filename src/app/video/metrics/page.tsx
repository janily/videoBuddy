'use client';
import Link from 'next/link';
import {useEffect,useState} from 'react';
import type {summarizeEvents} from '@/services/video/analytics/store';
type Dashboard=ReturnType<typeof summarizeEvents>;
const names:Record<string,string>={stage_enter:'进入创作阶段',style_recommend_shown:'看到画风推荐',style_selected:'选择画风',quick_reply_clicked:'点击快捷回复',script_ready:'脚本就绪',generate_clicked:'点击生成',shot_state:'镜头更新',result_ready:'成片就绪',result_downloaded:'下载成片',redo_shot:'重画镜头',music_changed:'更换配乐'};
const percent=(n:number|null)=>n===null?'暂无数据':`${Math.round(n*100)}%`;
const duration=(n:number|null)=>n===null?'暂无数据':`${Math.round(n/1000)} 秒`;
export default function MetricsPage(){
 const [data,setData]=useState<Dashboard|null>(null),[error,setError]=useState(false),[refresh,setRefresh]=useState(0);
 useEffect(()=>{let active=true;void fetch('/api/video/analytics',{cache:'no-store'}).then(async response=>{if(!response.ok)throw Error();return response.json() as Promise<Dashboard>}).then(value=>{if(active){setData(value);setError(false)}}).catch(()=>{if(active)setError(true)});return()=>{active=false}},[refresh]);
 return <main style={{maxWidth:900,margin:'40px auto',padding:'0 24px'}}><Link href="/video">← 返回工作台</Link><h1>我的创作数据</h1><p>仅展示当前会话身份下项目的实际记录，不包含聊天内容。</p><button onClick={()=>setRefresh(value=>value+1)}>刷新数据</button>{error?<p role="alert">数据暂时无法读取，请稍后刷新。</p>:!data?<p>正在读取…</p>:<>
 <p>已记录 {data.projectCount} 个项目、{data.eventCount} 次操作。</p>
 <dl style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(180px,1fr))',gap:24}}>{[
 ['画风推荐采纳率',percent(data.recommendationAdoptionRate)],['画布选择占比',percent(data.canvasSelectionRate)],['脚本等待时间（中位数）',duration(data.medianScriptReadyMs)],['成片等待时间（中位数）',duration(data.medianResultReadyMs)],
 ].map(([label,value])=><div key={label}><dt>{label}</dt><dd style={{margin:0,fontSize:28}}>{value}</dd></div>)}</dl>
 <h2>操作记录</h2><table style={{width:'100%',textAlign:'left'}}><thead><tr><th scope="col">操作</th><th scope="col">次数</th></tr></thead><tbody>{Object.entries(names).map(([key,label])=><tr key={key}><th scope="row">{label}</th><td>{data.eventCounts[key]||0}</td></tr>)}</tbody></table>
 <p>统计范围：最近 {data.coverage.maxProjects} 个有记录的项目，每个项目最多 {data.coverage.maxEventsPerProject} 条记录。客户端记录可能因离线或关闭页面缺失，刷新后观察到的重复事件也可能计入。</p><p>等待时间由客户端计时；首片 24 小时完成率、首片总耗时、生成前对话轮数及生成中流失率暂不展示，需要完整的服务端生命周期记录。</p>
 </>}</main>;
}
