'use client';
import {getStyle,listStyles} from '@/services/video/styles/registry';
import {StyleTile} from './StyleTile';
const examples=['crayon-book','paper-lantern','dataviz','risograph','pixel-rpg','brick-toy'];
export function StyleInspiration({onOpen}:{onOpen:(focusId?:string)=>void}){return <section className="style-inspiration" aria-labelledby="style-inspiration-title"><header><h2 id="style-inspiration-title">能做出这样的视频</h2><button className="text-button" onClick={()=>onOpen()}>逛逛全部画风 ↗</button></header><p>聊完想法后，助手会从 {listStyles().length} 种画风里挑 3 种给你。</p><div className="style-inspiration-grid">{examples.map(id=><StyleTile key={id} style={getStyle(id)} variant="compact" onSelect={()=>onOpen(id)}/>)}</div></section>}
