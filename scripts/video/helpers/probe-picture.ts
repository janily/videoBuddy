import type {MediaExecutor,MediaJob,MediaJobHandle} from '../../../src/services/video/media/executor';
export async function observeProbePicture(executor:MediaExecutor,job:MediaJob,persist:(handle:MediaJobHandle)=>Promise<void>,assertActive:()=>Promise<void>,timeoutMs:number,expected:'succeeded'|'failed'='succeeded'){
 const handle=await executor.submit(job);
 try{
  await persist(handle);
  const deadline=Date.now()+timeoutMs;
  let state=await executor.inspect(handle);
  while(state.status==='running'){await assertActive();if(Date.now()>deadline)throw Error('CLEAR_FULL_FILM_TIMEOUT');await new Promise(resolve=>setTimeout(resolve,1000));state=await executor.inspect(handle)}
  if(state.status!==expected||(expected==='succeeded'?state.outputs.join()!=='output/picture.mp4':state.outputs.length!==0))throw Error('CLEAR_FULL_FILM_PICTURE_FAILED');
  await assertActive();return handle;
 }catch(error){
  try{const stopped=await executor.cancel(handle);if(stopped.status!=='cancelled')throw Error('MEDIA_STOP_UNKNOWN')}catch(stopError){throw Error('MEDIA_STOP_UNKNOWN',{cause:stopError})}
  throw error;
 }
}
