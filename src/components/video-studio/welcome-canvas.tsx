'use client';
import {Icon} from './icons';
const examples=['给我的咖啡店做一支介绍视频','把这份资料讲成一个小故事','做一段让人看懂的知识科普'];
export function WelcomeCanvas({onExample,extra}:{onExample:(text:string)=>void;extra?:React.ReactNode}){
 return<section className="work" aria-label="视频结果"><div className="work-inner welcome"><span className="welcome-mark"><Icon name="play"/></span><span className="eyebrow">一个想法，就可以开始</span><h1>先聊聊，你想做什么视频？</h1><p className="intro">不用先写脚本，也不用一次想清楚。<br/>说说想法，或者发些资料，我们一起慢慢完善。</p>
  <div className="examples"><span>可以这样开始</span>{examples.map(example=><button key={example} onClick={()=>onExample(example)}>{example}<Icon name="arrow"/></button>)}</div>
  <ol className="how-it-works" aria-label="怎么做">{['聊清楚想讲什么','生成视频看看','不满意就聊着改'].map((text,i)=><li key={text}><span aria-hidden="true">{i+1}</span>{text}</li>)}</ol>
  <div className="secondary-row">{extra}</div></div></section>;
}
