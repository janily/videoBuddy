import {constants} from 'node:fs';
import {open} from 'node:fs/promises';
import {isAbsolute,join} from 'node:path';
import {Worker} from 'node:worker_threads';

/** Untrusted PDF parsing lives in a disposable, memory-bounded worker. Only the
 * verified input bytes cross the boundary; no host path or credentials do. */
export async function extractLocalPdfText(path:string,options:{signal?:AbortSignal}={}):Promise<string[]>{
 if(options.signal?.aborted)throw Error('PDF_CANCELLED');
 if(!isAbsolute(path)||/[\u0000-\u001f]/.test(path))throw Error('ASSET_INVALID');
 const file=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW).catch(()=>{throw Error('ASSET_INVALID')});
 let bytes:Uint8Array;
 try{
  const info=await file.stat();if(!info.isFile()||info.nlink!==1||info.size<5||info.size>20*1024*1024)throw Error('ASSET_INVALID');
  const data=await file.readFile();if(data.length!==info.size||data.subarray(0,5).toString()!=='%PDF-')throw Error('ASSET_INVALID');bytes=new Uint8Array(data);
 }finally{await file.close()}
 if(options.signal?.aborted)throw Error('PDF_CANCELLED');
 return new Promise((resolve,reject)=>{
  const worker=new Worker(join(process.cwd(),'src/services/video/assets/pdf-worker.mjs'),{
   workerData:bytes,transferList:[bytes.buffer as ArrayBuffer],execArgv:[],env:{},
   resourceLimits:{maxOldGenerationSizeMb:512,maxYoungGenerationSizeMb:64,stackSizeMb:8},
  });
  let settled=false;
  const finish=(error?:Error,pages?:string[])=>{if(settled)return;settled=true;clearTimeout(timer);options.signal?.removeEventListener('abort',cancel);void worker.terminate().then(()=>error?reject(error):resolve(pages!),()=>reject(error??Error('PDF_EXTRACTION_FAILED')))};
  const cancel=()=>finish(Error('PDF_CANCELLED'));
  const timer=setTimeout(()=>finish(Error('PDF_EXTRACTION_TIMEOUT')),60000);
  options.signal?.addEventListener('abort',cancel,{once:true});
  if(options.signal?.aborted)cancel();
  worker.once('message',(message:unknown)=>{
   const result=message as {pages?:unknown;error?:unknown};
   if(typeof result?.error==='string'){finish(Error(['PDF_PAGE_LIMIT','PDF_TEXT_LIMIT','PDF_TEXT_UNAVAILABLE'].includes(result.error)?result.error:'PDF_EXTRACTION_FAILED'));return}
   const pages=result?.pages;if(!Array.isArray(pages)||pages.length<1||pages.length>100||pages.some(page=>typeof page!=='string')){finish(Error('PDF_EXTRACTION_FAILED'));return}
   if(Buffer.byteLength(JSON.stringify(pages))>40000){finish(Error('PDF_TEXT_LIMIT'));return}
   if(!pages.some(page=>page.trim())){finish(Error('PDF_TEXT_UNAVAILABLE'));return}
   finish(undefined,pages);
  });
  worker.once('error',()=>finish(Error('PDF_EXTRACTION_FAILED')));
  worker.once('exit',()=>{if(!settled)finish(Error('PDF_EXTRACTION_FAILED'))});
 });
}
