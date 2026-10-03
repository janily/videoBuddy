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
import {reconcileDeletedProjects} from '../../src/services/video/commands/delete-project';
import {runRetentionMaintenance} from '../../src/services/video/commands/project-retention';
import {isAbsolute} from 'node:path';
async function main(){
 const root=process.env.VIDEO_DATA_DIR;if(!root||!isAbsolute(root))throw Error('CONFIGURATION_REQUIRED: VIDEO_DATA_DIR');
 const lease=await acquireWorkerLease(root),store=new FileStore(root),events=new LocalEventLog(root),queue=new LocalOperationQueue(store,root);
 let stop=false,lastExpirySweep=0;process.once('SIGTERM',()=>{stop=true});process.once('SIGINT',()=>{stop=true});
 let heartbeatPending=Promise.resolve();
 const heartbeat=setInterval(()=>{heartbeatPending=heartbeatPending.then(async()=>{if(!lease.alive()){stop=true;return}await writeWorkerHeartbeat(root)}).catch(()=>{stop=true})},5000);
 try{while(!stop){if(!lease.alive())throw Error('WORKER_LOCK_LOST');await writeWorkerHeartbeat(root);
  if(Date.now()-lastExpirySweep>=60000){const retention=await runRetentionMaintenance(store);if(retention.failed)console.error('WORKER_RETENTION_NEEDS_RECONCILIATION');const deletion=await reconcileDeletedProjects(store);if(deletion.failed)console.error('WORKER_DELETION_NEEDS_RECONCILIATION');await expirePendingUploads(root,store);lastExpirySweep=Date.now()}
  try{await runQueuedOnce(queue,store,async job=>{
   if(job.kind==='export'){await runExportOperation(store,events,job.projectId,job.operationId,{root});return}
   if(job.kind==='render'){await runApprovedRenderOperation(store,events,job.projectId,job.operationId,{root});return}
   requireGeneration();
   if(job.kind==='preview')await runPreviewOperation(store,events,job.projectId,job.operationId,{root});else await runDirectorOperation(store,events,job.projectId,job.operationId);
  })}catch{console.error('WORKER_JOB_NEEDS_RECONCILIATION')}
  await new Promise(resolve=>setTimeout(resolve,2000));
 }}finally{clearInterval(heartbeat);await heartbeatPending;await lease.release()}
}
main().catch(error=>{console.error(error instanceof Error?error.message:'WORKER_FAILED');process.exitCode=1});
