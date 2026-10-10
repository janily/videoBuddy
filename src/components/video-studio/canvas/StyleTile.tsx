'use client';
import type {StylePack} from '@/services/video/styles/registry';
import {styleFits} from '@/services/video/styles/recommendations';
import {StyleSample} from '../style-picker';
export function StyleTile({style,variant='default',reason,recommended,selected,disabled,onSelect}:{style:StylePack;variant?:'compact'|'default'|'row';reason?:string;recommended?:boolean;selected?:boolean;disabled?:boolean;onSelect:()=>void}){
 return <button type="button" id={`style-tile-${style.id}`} className={`style-tile style-tile-${variant}`} aria-pressed={Boolean(selected)} disabled={disabled} title={disabled?'正在生成，稍后再换':undefined} onClick={onSelect}>
 <StyleSample id={style.id}/><span className="style-tile-body"><strong>{style.nameZh}{selected?<span className="style-tag">当前</span>:recommended?<span className="style-tag">推荐</span>:null}</strong><span className={reason?'style-reason':'style-purpose'}>{reason?.slice(0,30)||styleFits[style.id]?.goodFor}</span></span>{selected?<span className="style-check" aria-label="已选">✓</span>:<span className="style-hover" aria-hidden="true">选这个</span>}
 </button>;
}
