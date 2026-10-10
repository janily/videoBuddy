'use client';
import Link from 'next/link';import {listStyles}from '@/services/video/styles/registry';
import {Icon} from './icons';
import {StyleSample} from './style-picker';
import {styleFits} from '@/services/video/styles/recommendations';
export function StyleCatalog(){return<main className="vb-easy catalog-page"><header className="topbar"><Link href="/video" className="brand"><span className="brand-mark"><Icon name="play"/></span>VideoBuddy</Link><Link href="/video" className="text-button">继续聊想法</Link></header><div className="catalog-content"><h1>{listStyles().length} 种画风，找到你的表达</h1><p className="intro">每一种都可以直接用来做视频。不确定选哪个，就告诉创作助手你想讲什么、给谁看，它会推荐最合适的几种。</p><div className="style-grid">{listStyles().map(s=><article key={s.id} className="style-card"><StyleSample id={s.id}/><h2>{s.nameZh}</h2><span className="style-en">{s.nameEn}</span>{styleFits[s.id]&&<small>适合：{styleFits[s.id].goodFor}</small>}<small>{s.technicalReviewFocus}</small><small className="style-category">{s.categoryZh}</small></article>)}</div></div></main>}
