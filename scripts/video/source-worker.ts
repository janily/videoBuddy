import {FileStore} from '../../src/services/video/storage/file-store';
import {acquireWorkerLease} from '../../src/services/video/commands/worker-lease';
import {runSourceAnalysisOnce} from '../../src/services/video/assets/source-worker';
import {assertPdfRuntime} from '../../src/services/video/assets/pdf-executor';

async function main(){
 const root=process.env.VIDEO_DATA_DIR;
 if(!root)throw Error('CONFIGURATION_REQUIRED: VIDEO_DATA_DIR');
 await assertPdfRuntime();
 const lease=await acquireWorkerLease(root,'source-worker'),store=new FileStore(root);
 let stop=false;process.once('SIGTERM',()=>{stop=true});process.once('SIGINT',()=>{stop=true});
 try{while(!stop){if(!lease.alive())throw Error('WORKER_LOCK_LOST');
  try{await runSourceAnalysisOnce(store,root)}catch{console.error('SOURCE_ANALYSIS_NEEDS_RECONCILIATION')}
  await new Promise(resolve=>setTimeout(resolve,2000));
 }}finally{await lease.release()}
}
main().catch(error=>{console.error(error instanceof Error?error.message:'SOURCE_WORKER_FAILED');process.exitCode=1});
