import {posix}from 'node:path';
import {parse} from 'acorn';
import type {RuntimeAsset} from './runtime-assets';
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
export interface OutputFile{path:string;symlink:boolean;hardlinks:number}
export function validateOutputPath(file:OutputFile,root:string){if(file.symlink||file.hardlinks!==1||/[\u0000-\u001f\u007f]/.test(file.path)||posix.isAbsolute(file.path)||file.path.split('/').includes('..')||!file.path.startsWith(root+'/')||posix.normalize(file.path)!==file.path||!/^[-a-zA-Z0-9_./]+$/.test(file.path))throw Error('OUTPUT_INVALID');return file.path}
export function validateSource(source:string){const inspected=sourceForStaticInspection(source);if(/\b(fetch|XMLHttpRequest|WebSocket|eval|require)\s*\(|process\s*\.|child_process|(?:https?:)?\/\//.test(inspected))throw Error('SOURCE_INVALID');if(!inspected.includes('render')||!inspected.includes('READY'))throw Error('SOURCE_INVALID: render contract');return{result:'pass' as const,scope:'static source gate only; sandbox isolation and independent QA still required'}}
export interface MediaJob{projectId:string;operationId:string;attemptId:string;stageKey:string;bundleHash:string;runtimeDigest:string;sourceHtml:string;logicalWidth:number;logicalHeight:number;outputWidth:number;outputHeight:number;fps:24|30|60;startFrame:number;endFrame:number;seed:number;fence:number;assets?:RuntimeAsset[]}
export interface MediaJobHandle{containerName:string;containerId:string;stageKey:string;runtimeDigest:string}
export interface MediaStatus{status:'running'|'succeeded'|'failed'|'cancelled';outputs:string[];errorCode?:string}
export interface MediaExecutor{submit(job:MediaJob):Promise<MediaJobHandle>;inspect(handle:MediaJobHandle):Promise<MediaStatus>;cancel(handle:MediaJobHandle):Promise<{status:'cancelled'|'cancelling'}>}
