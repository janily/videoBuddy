import {applyPendingDirectorFeedback} from '@/services/video/revisions/pending-feedback';
import {scheduleScriptDraft} from '@/services/video/quick/script';
import type {ProjectControl} from '@/contracts/video/project';
import {ProjectStore} from '@/services/video/storage/project-store';
import {AtomicStore,StoreMissing} from '@/services/video/storage/atomic-store';
import {readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {expireReservations} from '@/services/video/assets/reservations';
import {LocalOperationQueue,QueuedOperation} from './local-queue';
const terminal=new Set(['succeeded','failed','cancelled','interrupted','superseded']);
export async function runQueuedOnce(queue:LocalOperationQueue,store:AtomicStore,execute:(job:QueuedOperation)=>Promise<void>){
 let failure=await queue.reconcilePreviews();
 const exportFailure=await queue.reconcileExports();failure ||= exportFailure;
 const scriptFailure=await reconcileScripts(queue,store);failure ||= scriptFailure;
 const inventory=await queue.pendingWithFailures();failure ||= inventory.failure;
 for(const job of inventory.jobs){
  try{
  const key=`projects/${job.projectId}/operations/${job.operationId}`;
  const before=(await store.readFresh<{status:string;notBefore?:number}>(key)).value;
  if(job.kind==='script'&&before.notBefore&&before.notBefore>Date.now())continue;
  const recoveryControl=job.kind==='preview'&&before.status==='interrupted'?(await store.readFresh<ProjectControl>(`projects/${job.projectId}/control`)).value:undefined;
  const recovering=Boolean(recoveryControl&&(recoveryControl.unresolvedMediaStops?.[job.operationId]||recoveryControl.previewOutcomes?.[job.operationId]));
  if(terminal.has(before.status)&&!['export'].includes(job.kind)&&!recovering){await queue.complete(job.projectId,job.operationId);continue}
  if(!['chat','preview','export','script'].includes(job.kind))throw Error('CAPABILITY_UNAVAILABLE');
  await execute(job);
  const after=(await store.readFresh<{status:string}>(key)).value;
  if(terminal.has(after.status))await queue.complete(job.projectId,job.operationId);
  }catch(error){failure ||= error}
 }
 if(failure)throw failure;
}
export async function expirePendingUploads(root:string,store:AtomicStore){
 const dirs=await readdir(join(root,'projects'),{withFileTypes:true}).catch(error=>{if((error as NodeJS.ErrnoException).code==='ENOENT')return[];throw error});
 for(const dir of dirs){if(!dir.isDirectory()||!/^[a-f0-9-]{36}$/.test(dir.name))continue;
  try{await expireReservations(store,`projects/${dir.name}/control`)}catch(error){if(!(error instanceof StoreMissing))throw error}
 }
}

/** Rebuild script queue entries from project state after an interrupted request. */
async function reconcileScripts(queue:LocalOperationQueue,store:AtomicStore){
 if(!store.listKeys)return;
 let failure:unknown;
 for(const key of await store.listKeys('projects',2)){
  if(!/^projects\/[a-f0-9-]{36}\/control$/.test(key))continue;
  try{const projects=new ProjectStore(store),projectId=key.split('/')[1];await applyPendingDirectorFeedback(projects,projectId);await scheduleScriptDraft(projects,queue,projectId)}catch(error){failure ||= error}
 }
 return failure;
}

/** The quick pipeline never calls a model after drawing all shot sources.
 * Unknown stages remain serialized with conversations.
 */
export async function quickProductionAllowsChat(store:AtomicStore,job:QueuedOperation){
 if(job.kind!=='preview')return false;
 const op=(await store.readFresh<{id:string;projectId:string;kind:string;status:string;stage?:string}>(`projects/${job.projectId}/operations/${job.operationId}`)).value;
 return op.id===job.operationId&&op.projectId===job.projectId&&op.kind==='preview'&&op.status==='running'&&['picture','composition','music','publication'].includes(op.stage||'');
}

/** Default: one task at a time. An explicit admission policy may allow one chat
 * alongside a production that has permanently finished its model calls. This
 * preserves the global model gate: no overlapping chat/model phases, and no new
 * media or script job starts until the admitted conversation also finishes.
 * Dispatch remains nonblocking so new messages can be discovered while rendering.
 */
export function createWorkerLanes(execute:(job:QueuedOperation)=>Promise<void>,onError:(error:unknown)=>void,options:{canRunChatAlongside?:(running:QueuedOperation)=>Promise<boolean>}={}){
 const running=new Map<string,{job:QueuedOperation;task:Promise<void>}>();
 let admission=Promise.resolve();
 return{
  dispatch(job:QueuedOperation){
   const next=admission.then(async()=>{
    const id=`${job.projectId}/${job.operationId}`;if(running.has(id))return;
    if(running.size){
     if(job.kind!=='chat'||!options.canRunChatAlongside||[...running.values()].some(value=>value.job.kind==='chat'))return;
     for(const value of running.values())if(!await options.canRunChatAlongside(value.job))return;
    }
    const task=Promise.resolve().then(()=>execute(job)).catch(onError).finally(()=>{running.delete(id)});
    running.set(id,{job,task});
   });
   admission=next.catch(()=>undefined);return next;
  },
  async drain(){await admission;await Promise.all([...running.values()].map(value=>value.task))},
 };
}
