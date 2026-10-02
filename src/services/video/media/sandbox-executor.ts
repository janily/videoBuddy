import {Sandbox}from '@vercel/sandbox';
import {z}from 'zod';
import {MediaExecutor,MediaJob,MediaJobHandle,MediaStatus,sandboxConfiguration,validateSource}from './executor';
const statusSchema=z.strictObject({status:z.enum(['running','succeeded','failed','cancelled']),outputs:z.array(z.string()),errorCode:z.string().optional()});
export class SandboxExecutor implements MediaExecutor{
 async submit(job:MediaJob):Promise<MediaJobHandle>{
  validateSource(job.sourceHtml);if(!/^[a-f0-9]{64}$/.test(job.stageKey)||job.runtimeDigest!==process.env.VIDEO_SANDBOX_RUNTIME_DIGEST||!Number.isInteger(job.startFrame)||!Number.isInteger(job.endFrame)||job.startFrame<0||job.endFrame<=job.startFrame)throw Error('RENDER_JOB_INVALID');
  const sandbox=await Sandbox.getOrCreate(sandboxConfiguration(process.env,`${job.operationId}-${job.attemptId}`));
  const runtime=await sandbox.readFileToBuffer({path:'/opt/videobuddy/runtime-manifest.json'});if(!runtime||JSON.parse(runtime.toString()).runtimeDigest!==job.runtimeDigest){await sandbox.stop();throw Error('CAPABILITY_UNAVAILABLE: actual runtime digest mismatch')}
  await sandbox.mkDir(`/work/${job.stageKey}`);
  await sandbox.writeFiles([{path:`/work/${job.stageKey}/job.json`,content:Buffer.from(JSON.stringify(job))},{path:`/work/${job.stageKey}/scene.html`,content:Buffer.from(job.sourceHtml)}]);
  const command=await sandbox.runCommand({cmd:'python3',args:['/opt/videobuddy/runner.py','--run',job.stageKey],detached:true,env:{}});
  return{sandboxName:sandbox.name,commandId:command.cmdId,stageKey:job.stageKey,runtimeDigest:job.runtimeDigest};
 }
 async inspect(handle:MediaJobHandle):Promise<MediaStatus>{const sandbox=await Sandbox.get({name:handle.sandboxName});const result=await sandbox.runCommand({cmd:'python3',args:['/opt/videobuddy/runner.py','--status',handle.stageKey],env:{}});if(result.exitCode!==0)throw Error('MEDIA_STATUS_UNKNOWN');return statusSchema.parse(JSON.parse(await result.stdout()))}
 async cancel(handle:MediaJobHandle){const sandbox=await Sandbox.get({name:handle.sandboxName});await sandbox.stop();const stopped=await Sandbox.get({name:handle.sandboxName});return{status:stopped.status==='stopped'?'cancelled' as const:'cancelling' as const}}
}
