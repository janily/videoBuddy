'use client';
import Link from 'next/link';
import {useRouter} from 'next/navigation';
import {listStyles} from '@/services/video/styles/registry';
import {Icon} from './icons';
import {StyleTile} from './canvas/StyleTile';
export function StyleCatalog(){const router=useRouter();return <main className="vb-easy catalog-page"><header className="topbar"><Link href="/video" className="brand"><span className="brand-mark"><Icon name="play"/></span>VideoBuddy</Link><Link href="/video" className="text-button">继续聊想法</Link></header><div className="catalog-content"><h1>{listStyles().length} 种画风，找到你的表达</h1><p className="intro">每一种都可以直接用来做视频。不确定选哪个，就告诉创作助手你想讲什么、给谁看，它会推荐最合适的几种。</p><div className="style-library-grid">{listStyles().map(style=><StyleTile key={style.id} style={style} onSelect={()=>{router.push('/video')}}/>)}</div></div></main>}
