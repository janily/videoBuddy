import{spawn,ChildProcessWithoutNullStreams}from'node:child_process';
import{join}from'node:path';
export async function acquireWorkerLease(root:string,name:'worker'|'source-worker'='worker'):Promise<{alive:()=>boolean;release:()=>Promise<void>}>{
 const child:ChildProcessWithoutNullStreams=spawn(process.env.VIDEO_PYTHON_PATH||'python3',[join(process.cwd(),'runtime/storage/worker_lease.py'),root,name]);
 let live=true;child.once('close',()=>{live=false});
 const answer=await new Promise<string>((resolve,reject)=>{child.stdout.once('data',(chunk:Buffer)=>resolve(chunk.toString('utf8').trim()));child.once('error',reject)});
 if(answer!=='LOCKED'){child.stdin.end();throw Error(answer||'WORKER_LOCK_FAILED')}
 return{alive:()=>live,release:async()=>{if(!live)return;child.stdin.end();await new Promise<void>(resolve=>child.once('close',()=>resolve()))}};
}
