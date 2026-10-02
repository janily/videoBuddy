import{spawn}from'node:child_process';import{createHash}from'node:crypto';import{lstat,mkdir,open,readFile}from'node:fs/promises';import{isAbsolute,join}from'node:path';
import{z}from'zod';import{MediaExecutor,MediaJob,MediaJobHandle,MediaStatus,validateSource}from'./executor';
import{Environment}from'@/services/video/config/environment';
export function dockerConfiguration(env:Environment,operationId:string){
 const image=env.VIDEO_MEDIA_IMAGE_REF,timeout=Number(env.VIDEO_MEDIA_TIMEOUT_SECONDS);
 if(!image||!/^sha256:[a-f0-9]{64}$/.test(image)||image.slice(7)!==env.VIDEO_MEDIA_RUNTIME_DIGEST||!Number.isSafeInteger(timeout)||timeout<1||!/^[-a-zA-Z0-9]+$/.test(operationId))throw Error('CAPABILITY_UNAVAILABLE: pinned Docker runtime required');
 return{name:`vb-${operationId}`,image,runtimeDigest:env.VIDEO_MEDIA_RUNTIME_DIGEST!,timeoutSeconds:timeout,user:`${process.getuid?.()??10001}:${process.getgid?.()??10001}`};
}
export function computeStageKey(job:Omit<MediaJob,'stageKey'|'operationId'|'attemptId'>){
 const sourceHash=createHash('sha256').update(job.sourceHtml).digest('hex');
 return createHash('sha256').update(JSON.stringify([job.projectId,job.bundleHash,job.runtimeDigest,sourceHash,job.logicalWidth,job.logicalHeight,job.outputWidth,job.outputHeight,job.fps,job.startFrame,job.endFrame,job.seed,job.fence])).digest('hex');
}
export function dockerArguments(config:ReturnType<typeof dockerConfiguration>,stageDir:string,stageKey:string){
 if(!isAbsolute(stageDir)||!/^\/[A-Za-z0-9_./-]+$/.test(stageDir)||!/^[a-f0-9]{64}$/.test(stageKey))throw Error('RENDER_JOB_INVALID');
 return['run','--detach','--name',config.name,'--network','none','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges','--pids-limit','128','--cpus','4','--memory','8g','--memory-swap','8g','--user',config.user,'--tmpfs','/tmp:rw,nosuid,size=256m','--mount',`type=bind,src=${stageDir},dst=/work/${stageKey}`,'--mount',`type=bind,src=${stageDir}/job.json,dst=/work/${stageKey}/job.json,readonly`,'--mount',`type=bind,src=${stageDir}/scene.html,dst=/work/${stageKey}/scene.html,readonly`,'--env',`VIDEO_RENDER_TIMEOUT_SECONDS=${config.timeoutSeconds}`,'--label',`videobuddy.stageKey=${stageKey}`,config.image,'python3','/opt/videobuddy/runner.py','--run',stageKey];
}
async function docker(args:string[]){const child=spawn('docker',args,{stdio:['ignore','pipe','pipe'],signal:AbortSignal.timeout(30000)}),out:Buffer[]=[],err:Buffer[]=[];
 child.stdout.on('data',(part:Buffer)=>{if(Buffer.concat(out).length<1024*1024)out.push(part)});child.stderr.on('data',(part:Buffer)=>{if(Buffer.concat(err).length<8192)err.push(part)});
 const code=await new Promise<number>((resolve,reject)=>{child.once('error',reject);child.once('close',code=>resolve(code??1))});
 if(code!==0)throw Error(`MEDIA_EXECUTOR_UNAVAILABLE: ${Buffer.concat(err).toString('utf8').trim().slice(0,512)}`);return Buffer.concat(out).toString('utf8').trim();
}
const statusSchema=z.strictObject({status:z.enum(['running','succeeded','failed','cancelled']),outputs:z.array(z.string()),errorCode:z.string().optional()});
export async function writeStageInputs(stageDir:string,scene:string,jobDocument:string){
 async function createOrVerify(name:string,value:string){const path=join(stageDir,name);
  try{const file=await open(path,'wx',0o600);try{await file.writeFile(value);await file.sync()}finally{await file.close()}}
  catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;if(await readFile(path,'utf8')!==value)throw Error('STAGE_UNKNOWN')}
 }
 await createOrVerify('scene.html',scene);await createOrVerify('job.json',jobDocument);
 const dir=await open(stageDir,'r');try{await dir.sync()}finally{await dir.close()}
}
export class DockerExecutor implements MediaExecutor{
 constructor(private root:string){if(!isAbsolute(root))throw Error('CONFIGURATION_REQUIRED: VIDEO_DATA_DIR')}
 async submit(job:MediaJob):Promise<MediaJobHandle>{
  validateSource(job.sourceHtml);
  const dimensions=[job.logicalWidth,job.logicalHeight,job.outputWidth,job.outputHeight];
  if(!/^[a-f0-9]{64}$/.test(job.stageKey)||!/^[a-f0-9]{64}$/.test(job.bundleHash)||
   dimensions.some(value=>!Number.isSafeInteger(value)||value<64||value>3840)||job.outputWidth%2||job.outputHeight%2||
   ![24,30,60].includes(job.fps)||!Number.isSafeInteger(job.startFrame)||!Number.isSafeInteger(job.endFrame)||job.startFrame<0||job.endFrame<=job.startFrame||job.endFrame-job.startFrame>7200||
   !Number.isSafeInteger(job.seed)||!Number.isSafeInteger(job.fence)||job.fence<0||job.stageKey!==computeStageKey(job))throw Error('RENDER_JOB_INVALID');
  const config=dockerConfiguration(process.env,`${job.operationId}-${job.attemptId}`);if(job.runtimeDigest!==config.runtimeDigest)throw Error('RENDER_JOB_INVALID');
  const stageDir=join(this.root,'media',job.stageKey);await mkdir(stageDir,{recursive:true});
  await writeStageInputs(stageDir,job.sourceHtml,JSON.stringify(job));
  let containerId:string;
  try{containerId=await docker(dockerArguments(config,stageDir,job.stageKey))}catch(error){
   const existing=await docker(['inspect','--format','{{.Id}} {{index .Config.Labels "videobuddy.stageKey"}} {{.Image}}',config.name]).catch(()=>null);
   if(!existing)throw error;const[id,stageKey,image]=existing.split(' ');
   if(stageKey!==job.stageKey||image!==config.image)throw Error('MEDIA_STATUS_UNKNOWN');containerId=id;
  }
  return{containerName:config.name,containerId,stageKey:job.stageKey,runtimeDigest:job.runtimeDigest};
 }
 async inspect(handle:MediaJobHandle):Promise<MediaStatus>{
  const state=await docker(['inspect','--format','{{.State.Status}} {{.Id}} {{.State.ExitCode}}',handle.containerName]);const [status,id,exitCode]=state.split(' ');
  if(id!==handle.containerId)throw Error('MEDIA_STATUS_UNKNOWN');
  if(status==='running'||status==='created')return{status:'running',outputs:[]};
  if(status!=='exited')throw Error('MEDIA_STATUS_UNKNOWN');
  const marker=await readFile(join(this.root,'media',handle.stageKey,'state.json'),'utf8').catch(()=>null);if(!marker)throw Error('STAGE_UNKNOWN');const result=statusSchema.parse(JSON.parse(marker));
  if(result.status==='succeeded'){
   if(exitCode!=='0')throw Error('MEDIA_STATUS_UNKNOWN');
   if(result.outputs.length!==1||result.outputs[0]!=='output/picture.mp4')throw Error('OUTPUT_INVALID');
   const file=await lstat(join(this.root,'media',handle.stageKey,'output','picture.mp4'));
   if(!file.isFile()||file.isSymbolicLink()||file.nlink!==1||file.size===0)throw Error('OUTPUT_INVALID');
  }
  return result;
 }
 async cancel(handle:MediaJobHandle){
  if(await docker(['inspect','--format','{{.Id}}',handle.containerName])!==handle.containerId)throw Error('MEDIA_STATUS_UNKNOWN');
  await docker(['stop','--time','10',handle.containerName]);const state=await docker(['inspect','--format','{{.State.Status}}',handle.containerName]);return{status:state==='exited'?'cancelled' as const:'cancelling' as const};
 }
}
