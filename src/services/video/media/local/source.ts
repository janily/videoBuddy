import {parse} from 'acorn';
export function sourceForStaticInspection(source:string){
 if(source.length>2*1024*1024)throw Error('SOURCE_INVALID');
 let fromHtml=0,result='';
 const outsideScript=(html:string)=>html.replace(/<!--[\s\S]*?-->/g,'');
 for(const match of source.matchAll(/(<script\b[^>]*>)([\s\S]*?)(<\/script\s*>)/gi)){
  const [,opening,script,closing]=match;
  result+=outsideScript(source.slice(fromHtml,match.index));
  const comments:Array<{start:number;end:number}>=[];
  try{parse(script,{ecmaVersion:'latest',sourceType:'script',onComment:(_block,_text,start,end)=>{comments.push({start,end})}})}catch{throw Error('SOURCE_INVALID: script syntax')}
  let from=0,inspected='';for(const comment of comments){inspected+=script.slice(from,comment.start)+' ';from=comment.end}inspected+=script.slice(from);
  result+=opening+inspected+closing;fromHtml=match.index+match[0].length;
 }
 return result+outsideScript(source.slice(fromHtml));
}
export function validateSource(source:string){const inspected=sourceForStaticInspection(source);if(/\b(fetch|XMLHttpRequest|WebSocket|eval|require)\s*\(|process\s*\.|child_process|(?:https?:)?\/\//.test(inspected))throw Error('SOURCE_INVALID');if(!inspected.includes('render')||!inspected.includes('READY'))throw Error('SOURCE_INVALID: render contract');return{result:'pass' as const,scope:'static source gate only; sandbox isolation and independent QA still required'}}
