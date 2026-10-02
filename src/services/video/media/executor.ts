import {posix}from 'node:path';
import type{Environment}from '@/services/video/config/environment';
export interface OutputFile{path:string;symlink:boolean;hardlinks:number}
export function validateOutputPath(file:OutputFile,root:string){if(file.symlink||file.hardlinks!==1||/[\u0000-\u001f\u007f]/.test(file.path)||posix.isAbsolute(file.path)||file.path.split('/').includes('..')||!file.path.startsWith(root+'/')||posix.normalize(file.path)!==file.path||!/^[-a-zA-Z0-9_./]+$/.test(file.path))throw Error('OUTPUT_INVALID');return file.path}
export function sandboxConfiguration(env:Environment,operationId:string){
 if(!env.VIDEO_SANDBOX_IMAGE_REF?.match(/@sha256:[a-f0-9]{64}$/)||!env.VIDEO_SANDBOX_RUNTIME_DIGEST?.match(/^[a-f0-9]{64}$/)||!/^[-a-zA-Z0-9]+$/.test(operationId)||!env.VIDEO_SANDBOX_TIMEOUT_SECONDS||!Number.isSafeInteger(Number(env.VIDEO_SANDBOX_TIMEOUT_SECONDS))||Number(env.VIDEO_SANDBOX_TIMEOUT_SECONDS)<1)throw Error('CAPABILITY_UNAVAILABLE: pinned sandbox runtime required');
 return{name:`vb-${operationId}`,image:env.VIDEO_SANDBOX_IMAGE_REF,networkPolicy:'deny-all' as const,env:{},timeout:Number(env.VIDEO_SANDBOX_TIMEOUT_SECONDS)*1000,resources:{vcpus:4}};
}
export function validateSource(source:string){if(source.length>2*1024*1024||/\b(fetch|XMLHttpRequest|WebSocket|eval|require)\s*\(|process\s*\.|child_process|(?:https?:)?\/\//.test(source))throw Error('SOURCE_INVALID');if(!source.includes('render')||!source.includes('READY'))throw Error('SOURCE_INVALID: render contract');return{result:'pass' as const,scope:'static source gate only; sandbox isolation and independent QA still required'}}
export interface MediaJob{projectId:string;operationId:string;attemptId:string;stageKey:string;bundleHash:string;runtimeDigest:string;sourceHtml:string;logicalWidth:number;logicalHeight:number;outputWidth:number;outputHeight:number;fps:24|30|60;startFrame:number;endFrame:number;seed:number;fence:number}
export interface MediaJobHandle{sandboxName:string;commandId:string;stageKey:string;runtimeDigest:string}
export interface MediaStatus{status:'running'|'succeeded'|'failed'|'cancelled';outputs:string[];errorCode?:string}
export interface MediaExecutor{submit(job:MediaJob):Promise<MediaJobHandle>;inspect(handle:MediaJobHandle):Promise<MediaStatus>;cancel(handle:MediaJobHandle):Promise<{status:'cancelled'|'cancelling'}>}
