import {constants,createReadStream} from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import {lstat,open,realpath,mkdir,rename,rm,readFile} from 'node:fs/promises';
import {isAbsolute,join,resolve} from 'node:path';
export const sha256=(data:Buffer|string)=>createHash('sha256').update(data).digest('hex');
export function safeAbsolute(path:string){if(!isAbsolute(path)||/[\0-\x1f\x7f]/.test(path))throw Error('MEDIA_PATH_INVALID');return path}
export async function privateDirectory(path:string){await mkdir(path,{recursive:true,mode:0o750});const stat=await lstat(path);if(!stat.isDirectory()||stat.isSymbolicLink()||await realpath(path)!==resolve(path))throw Error('MEDIA_PATH_INVALID');return path}
export async function fileIdentity(path:string,expected?:{sha256:string;bytes:number},maxBytes=1024*1024*1024){
 safeAbsolute(path);if(await realpath(path)!==resolve(path))throw Error('MEDIA_PATH_INVALID');
 const file=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);
 try{const stat=await file.stat();if(!stat.isFile()||stat.nlink!==1||stat.size<1||stat.size>maxBytes)throw Error('MEDIA_FILE_INVALID');
  const hash=createHash('sha256');let bytes=0;for await(const chunk of file.createReadStream({autoClose:false})){bytes+=chunk.length;hash.update(chunk)}
  const digest=hash.digest('hex');if(bytes!==stat.size||expected&&(digest!==expected.sha256||bytes!==expected.bytes))throw Error('MEDIA_HASH_MISMATCH');return{sha256:digest,bytes};
 }finally{await file.close()}
}
export async function verifiedBytes(path:string,expected?:{sha256:string;bytes:number},maxBytes=50*1024*1024){
 await fileIdentity(path,expected,maxBytes);const data=await readFile(path);if(data.length>maxBytes||expected&&(sha256(data)!==expected.sha256||data.length!==expected.bytes))throw Error('MEDIA_HASH_MISMATCH');return data;
}
export async function durableWrite(path:string,data:Buffer|string){const fd=await open(path,'wx',0o640);try{await fd.writeFile(data);await fd.sync()}finally{await fd.close()}}
export async function syncDirectory(path:string){const fd=await open(path,'r');try{await fd.sync()}finally{await fd.close()}}
const stages=new Map<string,Promise<unknown>>();
/** In-process deduplication plus immutable directory publication across processes. */
export async function serialized<T>(key:string,work:()=>Promise<T>):Promise<T>{
 const previous=stages.get(key)||Promise.resolve(),current=previous.catch(()=>{}).then(work);stages.set(key,current);
 try{return await current}finally{if(stages.get(key)===current)stages.delete(key)}
}
export async function publishDirectory(temp:string,target:string){await syncDirectory(temp);try{await rename(temp,target)}catch(error){if(!['EEXIST','ENOTEMPTY'].includes((error as NodeJS.ErrnoException).code||''))throw error;await rm(temp,{recursive:true,force:true})}}
export async function temporaryStage(root:string,key:string){if(!/^[a-f0-9]{64}$/.test(key))throw Error('MEDIA_KEY_INVALID');await privateDirectory(root);const path=join(root,`${key}.${randomUUID()}.partial`);await privateDirectory(path);return path}
// Export a streaming reader only for trusted, previously verified local media.
export {createReadStream};
