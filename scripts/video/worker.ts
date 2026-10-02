import {FileStore} from '../../src/services/video/storage/file-store';
import {LocalEventLog} from '../../src/services/video/stream/local-event-log';
import {LocalOperationQueue} from '../../src/services/video/commands/local-queue';
import {acquireWorkerLease} from '../../src/services/video/commands/worker-lease';
import {writeWorkerHeartbeat} from '../../src/services/video/commands/worker-heartbeat';
import {expirePendingUploads,runQueuedOnce} from '../../src/services/video/commands/local-worker';
import {runDirectorOperation} from '../../src/services/video/commands/local-director';
import {requireGeneration} from '../../src/services/video/config/environment';
async function main(){
 requireGeneration();const root=process.env.VIDEO_DATA_DIR!;
 const lease=await acquireWorkerLease(root),store=new FileStore(root),events=new LocalEventLog(root),queue=new LocalOperationQueue(store,root);
 let stop=false,lastExpirySweep=0;process.once('SIGTERM',()=>{stop=true});process.once('SIGINT',()=>{stop=true});
 try{while(!stop){if(!lease.alive())throw Error('WORKER_LOCK_LOST');await writeWorkerHeartbeat(root);
  try{await runQueuedOnce(queue,store,job=>runDirectorOperation(store,events,job.projectId,job.operationId))}catch{console.error('WORKER_JOB_NEEDS_RECONCILIATION')}
  if(Date.now()-lastExpirySweep>=60000){await expirePendingUploads(root,store);lastExpirySweep=Date.now()}
  await new Promise(resolve=>setTimeout(resolve,2000));
 }}finally{await lease.release()}
}
main().catch(error=>{console.error(error instanceof Error?error.message:'WORKER_FAILED');process.exitCode=1});
