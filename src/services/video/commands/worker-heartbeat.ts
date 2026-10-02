import{mkdir,stat,writeFile}from'node:fs/promises';import{join}from'node:path';
export async function writeWorkerHeartbeat(root:string){await mkdir(root,{recursive:true});await writeFile(join(root,'worker-heartbeat'),new Date().toISOString())}
export async function assertWorkerReady(root:string){try{const status=await stat(join(root,'worker-heartbeat'));if(Date.now()-status.mtimeMs<=15000)return}catch{}throw Error('WORKER_UNAVAILABLE')}
