import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {mkdtemp,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {computeStageKey,DockerExecutor} from '../../src/services/video/media/docker-executor';
import {technicalVideoQa} from '../../src/services/video/media/technical-qa';

async function command(args:string[],includeStderr=false){
  const child=spawn('docker',args,{stdio:['ignore','pipe','pipe']}),stdout:Buffer[]=[],stderr:Buffer[]=[];
  child.stdout.on('data',(chunk:Buffer)=>stdout.push(chunk));child.stderr.on('data',(chunk:Buffer)=>stderr.push(chunk));
  const code=await new Promise<number>((resolve,reject)=>{child.once('error',reject);child.once('close',value=>resolve(value??1))});
  if(code!==0)throw Error(`docker failed: ${Buffer.concat(stderr).toString('utf8')}`);
  return Buffer.concat(includeStderr?[...stdout,...stderr]:stdout).toString('utf8').trim();
}

const image=process.env.VIDEO_MEDIA_IMAGE_REF;
if(!image||!/^sha256:[a-f0-9]{64}$/.test(image))throw Error('VIDEO_MEDIA_IMAGE_REF must be an immutable local image ID');
process.env.VIDEO_MEDIA_RUNTIME_DIGEST=image.slice(7);
process.env.VIDEO_MEDIA_TIMEOUT_SECONDS='120';
const root=await mkdtemp(join(tmpdir(),'vb-media-probe-'));
const sourceHtml='<!doctype html><meta charset="utf-8"><body style="margin:0;background:#132b45"><canvas id="c" width="320" height="180"></canvas><script>const c=document.getElementById("c"),x=c.getContext("2d");window.render=t=>{x.fillStyle="#132b45";x.fillRect(0,0,320,180);x.fillStyle="#fff";x.font="bold 36px sans-serif";x.fillText("视频探针",20,85);x.fillText(String(t.toFixed(2)),20,140)};window.READY=true;</script>';
const executor=new DockerExecutor(root);
const parameters={projectId:'probe',bundleHash:'a'.repeat(64),runtimeDigest:image.slice(7),sourceHtml,logicalWidth:320,logicalHeight:180,outputWidth:320,outputHeight:180,fps:24 as const,startFrame:0,endFrame:24,seed:1,fence:1};
const stageKey=computeStageKey(parameters);
const handle=await executor.submit({...parameters,operationId:randomUUID(),attemptId:'one',stageKey});
let state=await executor.inspect(handle);
const deadline=Date.now()+120_000;
while(state.status==='running'&&Date.now()<deadline){await new Promise(resolve=>setTimeout(resolve,1000));state=await executor.inspect(handle)}
if(state.status!=='succeeded')throw Error(`media probe failed: ${JSON.stringify(state)}`);
const file=join(root,'media',stageKey,'output','picture.mp4');
const size=(await stat(file)).size;
const probe=await command(['run','--rm','--network','none','--read-only','--mount',`type=bind,src=${join(root,'media',stageKey)},dst=/work,readonly`,image,'ffprobe','-v','error','-show_entries','format=duration:stream=codec_name,width,height','-of','json','/work/output/picture.mp4']);
const metadata=JSON.parse(probe) as {streams?:{codec_name?:string;width?:number;height?:number}[];format?:{duration?:string}};
if(size<1000||!metadata.streams?.some(stream=>stream.codec_name==='h264'&&stream.width===320&&stream.height===180)||Math.abs(Number(metadata.format?.duration)-1)>0.1)throw Error('MEDIA_PROBE_INVALID_OUTPUT');
const qa=await technicalVideoQa(join(root,'media',stageKey),image,'output/picture.mp4',{width:320,height:180,durationSec:1,fps:24,audio:false});
await command(['rm','--force',handle.containerName]);
const hanging={...parameters,sourceHtml:'<!doctype html><script>window.READY=true;window.render=()=>new Promise(()=>{});</script>'};
const stopHandle=await executor.submit({...hanging,operationId:randomUUID(),attemptId:'one',stageKey:computeStageKey(hanging)});
const beforeStop=await executor.inspect(stopHandle);
if(beforeStop.status!=='running')throw Error('MEDIA_STOP_PROBE_NOT_RUNNING');
const stop=await executor.cancel(stopHandle);
if(stop.status!=='cancelled')throw Error('MEDIA_STOP_PROBE_FAILED');
await command(['rm','--force',stopHandle.containerName]);
const randomScene='<!doctype html><canvas id="c" width="320" height="180"></canvas><script>const c=document.getElementById("c"),x=c.getContext("2d");window.render=()=>{x.fillStyle="#"+Math.floor(Math.random()*16777215).toString(16).padStart(6,"0");x.fillRect(0,0,320,180)};window.READY=true;</script>';
const changing={...parameters,sourceHtml:randomScene},changingHandle=await executor.submit({...changing,operationId:randomUUID(),attemptId:'one',stageKey:computeStageKey(changing)});
let changingState=await executor.inspect(changingHandle);
const changingDeadline=Date.now()+30000;
while(changingState.status==='running'&&Date.now()<changingDeadline){await new Promise(resolve=>setTimeout(resolve,100));changingState=await executor.inspect(changingHandle)}
const logs=await command(['logs',changingHandle.containerName],true);
if(changingState.status!=='failed'||!logs.includes('NONDETERMINISTIC_SCENE'))throw Error(`MEDIA_DETERMINISM_PROBE_FAILED: ${JSON.stringify(changingState)}`);
await command(['rm','--force',changingHandle.containerName]);
console.log(JSON.stringify({status:state.status,containerId:handle.containerId,image,bytes:size,ffprobe:metadata,technicalQa:qa,stopProbe:stop,determinismProbe:{status:'rejected'},temporaryDirectory:root},null,2));
