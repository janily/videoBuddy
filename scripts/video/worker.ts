import {FileStore} from '../../src/services/video/storage/file-store';
import {LocalEventLog} from '../../src/services/video/stream/local-event-log';
import {LocalOperationQueue} from '../../src/services/video/commands/local-queue';
import {acquireWorkerLease} from '../../src/services/video/commands/worker-lease';
import {writeWorkerHeartbeat} from '../../src/services/video/commands/worker-heartbeat';
import {expirePendingUploads,runQueuedOnce} from '../../src/services/video/commands/local-worker';
import {runDirectorOperation} from '../../src/services/video/commands/local-director';
import {runPreviewOperation} from '../../src/services/video/commands/local-preview';
import {runApprovedRenderOperation} from '../../src/services/video/commands/local-render';
import {runExportOperation} from '../../src/services/video/exports/operation';
import {requireGeneration} from '../../src/services/video/config/environment';
import {isAbsolute} from 'node:path';
async function main(){
 const root=process.env.VIDEO_DATA_DIR;if(!root||!isAbsolute(root))throw Error('CONFIGURATION_REQUIRED: VIDEO_DATA_DIR');
 const lease=await acquireWorkerLease(root),store=new FileStore(root),events=new LocalEventLog(root),queue=new LocalOperationQueue(store,root);
 let stop=false,lastExpirySweep=0;process.once('SIGTERM',()=>{stop=true});process.once('SIGINT',()=>{stop=true});
 let heartbeatPending=Promise.resolve();
 const heartbeat=setInterval(()=>{heartbeatPending=heartbeatPending.then(async()=>{if(!lease.alive()){stop=true;return}await writeWorkerHeartbeat(root)}).catch(()=>{stop=true})},5000);
 try{while(!stop){if(!lease.alive())throw Error('WORKER_LOCK_LOST');await writeWorkerHeartbeat(root);
  try{await runQueuedOnce(queue,store,async job=>{
   if(job.kind==='export'){await runExportOperation(store,events,job.projectId,job.operationId,{root});return}
   if(job.kind==='render'){await runApprovedRenderOperation(store,events,job.projectId,job.operationId,{root});return}
   requireGeneration();
   if(job.kind==='preview')await runPreviewOperation(store,events,job.projectId,job.operationId,{root});else await runDirectorOperation(store,events,job.projectId,job.operationId);
  })}catch{console.error('WORKER_JOB_NEEDS_RECONCILIATION')}
  if(Date.now()-lastExpirySweep>=60000){await expirePendingUploads(root,store);lastExpirySweep=Date.now()}
  await new Promise(resolve=>setTimeout(resolve,2000));
 }}finally{clearInterval(heartbeat);await heartbeatPending;await lease.release()}
}
main().catch(error=>{console.error(error instanceof Error?error.message:'WORKER_FAILED');process.exitCode=1});
