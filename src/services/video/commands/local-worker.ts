import {AtomicStore} from '@/services/video/storage/atomic-store';
import {readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {expireReservations} from '@/services/video/assets/reservations';
import {LocalOperationQueue,QueuedOperation} from './local-queue';
const terminal=new Set(['succeeded','failed','cancelled','interrupted','superseded']);
export async function runQueuedOnce(queue:LocalOperationQueue,store:AtomicStore,execute:(job:QueuedOperation)=>Promise<void>){
 for(const job of await queue.pending()){
  const key=`projects/${job.projectId}/operations/${job.operationId}`;
  const before=(await store.readFresh<{status:string}>(key)).value;
  if(terminal.has(before.status)){await queue.complete(job.projectId,job.operationId);continue}
  if(job.kind!=='chat')throw Error('CAPABILITY_UNAVAILABLE');
  await execute(job);
  const after=(await store.readFresh<{status:string}>(key)).value;
  if(terminal.has(after.status))await queue.complete(job.projectId,job.operationId);
 }
}
export async function expirePendingUploads(root:string,store:AtomicStore){
 const dirs=await readdir(join(root,'projects'),{withFileTypes:true}).catch(error=>{if((error as NodeJS.ErrnoException).code==='ENOENT')return[];throw error});
 for(const dir of dirs){if(!dir.isDirectory()||!/^[a-f0-9-]{36}$/.test(dir.name))continue;
  await expireReservations(store,`projects/${dir.name}/control`);
 }
}
