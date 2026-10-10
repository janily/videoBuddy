'use client';
export function QuickReplies({items,onSend,disabled}:{items:{label:string;text:string}[];onSend:(text:string,index:number)=>void;disabled?:boolean}){return <div className="quick-replies" aria-label="快捷回复">{items.slice(0,4).map((item,index)=><button key={`${index}:${item.text}`} disabled={disabled} onClick={()=>onSend(item.text,index)}>{item.label}</button>)}</div>}
