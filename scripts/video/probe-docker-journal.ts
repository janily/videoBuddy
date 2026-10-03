import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {FileStore} from '../../src/services/video/storage/file-store';
import {StoreMissing} from '../../src/services/video/storage/atomic-store';
import {runOwnedDocker} from '../../src/services/video/media/owned-docker';
import {dockerArgumentsHash,stopJournaledDocker,type DockerInvocation} from '../../src/services/video/media/docker-journal';
async function inspect(name:string){
 const task=spawn('docker',['inspect',name],{stdio:['ignore','pipe','ignore'],signal:AbortSignal.timeout(15000)}),chunks:Buffer[]=[];let size=0;
 task.stdout.on('data',(chunk:Buffer)=>{size+=chunk.length;if(size<=65536)chunks.push(chunk)});
 const code=await new Promise<number>((resolve,reject)=>{task.once('error',reject);task.once('close',value=>resolve(value??1))});
 if(size>65536)throw Error('DOCKER_JOURNAL_PROBE_OUTPUT_LIMIT');
 if(code!==0){
  const check=spawn('docker',['ps','--all','--quiet','--no-trunc','--filter','name=^/'+name+'$'],{stdio:['ignore','pipe','ignore'],signal:AbortSignal.timeout(15000)}),matches:Buffer[]=[];let bytes=0;
  check.stdout.on('data',(chunk:Buffer)=>{bytes+=chunk.length;if(bytes<=2048)matches.push(chunk)});
  const status=await new Promise<number>((resolve,reject)=>{check.once('error',reject);check.once('close',value=>resolve(value??1))});
  if(status!==0||bytes>2048||Buffer.concat(matches).toString('utf8').trim())throw Error('DOCKER_JOURNAL_PROBE_RESOURCE_UNKNOWN');return null;
 }
 return JSON.parse(Buffer.concat(chunks).toString('utf8'))[0];
}
async function main(){
 if(!process.argv.includes('--docker-journal-lifecycle'))throw Error('DOCKER_JOURNAL_PROBE_OPT_IN_REQUIRED');
 const imageProof=JSON.parse(await readFile('docs/engineering/evidence/native-package-probe.json','utf8'));
 const source=new FileStore(imageProof.root),prefix=`projects/${imageProof.projectId}`,control=(await source.readFresh(prefix+'/control')).etag,budget=(await source.readFresh(prefix+'/budget')).etag;
 const audio=(await source.readFresh<{runtimeDigest:string}>(imageProof.audio.packageRef.key)).value,image='sha256:'+audio.runtimeDigest;
 // Native real-time FFmpeg signal processing tests resource ownership only.
 // It is neither model-authored media nor a production video substitute.
 const args=['run','--rm','--network','none','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges','--pids-limit','64','--cpus','1','--memory','256m','--memory-swap','256m','--user','65532:65532',image,'ffmpeg','-nostdin','-hide_banner','-loglevel','error','-re','-f','lavfi','-i','sine=frequency=440:sample_rate=48000','-t','60','-f','null','-'];
 if(process.argv.includes('--child')){
  const root=process.argv[process.argv.indexOf('--root')+1],journalPrefix=process.argv[process.argv.indexOf('--journal-prefix')+1];
  await runOwnedDocker(args,90000,image,undefined,{store:new FileStore(root),prefix:journalPrefix});return;
 }
 const root=await mkdtemp(resolve('.video-local/docker-journal-probe-')),journalPrefix=`projects/${randomUUID()}/operations/${randomUUID()}/media-effects`,hash=dockerArgumentsHash(args,image),key=journalPrefix+'/'+hash;
 const child=spawn(process.execPath,['--import','tsx','scripts/video/probe-docker-journal.ts','--docker-journal-lifecycle','--child','--root',root,'--journal-prefix',journalPrefix],{stdio:['ignore','ignore','pipe']});
 child.stderr.resume();const exited=new Promise<{code:number|null;signal:NodeJS.Signals|null}>((resolve,reject)=>{child.once('error',reject);child.once('close',(code,signal)=>resolve({code,signal}))});
 const store=new FileStore(root);let record:DockerInvocation|undefined,container:Awaited<ReturnType<typeof inspect>>,observationRetries=0;const deadline=Date.now()+20000;
 try{
  while(Date.now()<deadline){
   try{record=(await store.readFresh<DockerInvocation>(key)).value}catch(error){if(!(error instanceof StoreMissing))throw error}
   if(record){
    try{container=await inspect('vb-media-'+record.invocation);if(container?.State.Running)break}
    catch(error){if(!(error instanceof Error)||error.message!=='DOCKER_JOURNAL_PROBE_RESOURCE_UNKNOWN')throw error;observationRetries++}
   }
   await new Promise(resolve=>setTimeout(resolve,100));
  }
  if(!record||record.state!=='started'||!container?.State.Running||container.Image!==image||container.Config.Labels['videobuddy.invocation']!==record.invocation||container.Config.Labels['videobuddy.arguments']!==hash)throw Error('DOCKER_JOURNAL_PROBE_NO_BOUND_RUNNING_RESOURCE');
  child.kill('SIGKILL');const hostExit=await exited;if(hostExit.signal!=='SIGKILL')throw Error('DOCKER_JOURNAL_PROBE_HOST_NOT_TERMINATED');
  const cold={store:new FileStore(root),prefix:journalPrefix},coldRecord=(await cold.store.readFresh<DockerInvocation>(key)).value;
  const beforeStop=await inspect('vb-media-'+record.invocation);if(!beforeStop?.State.Running||beforeStop.Id!==container.Id)throw Error('DOCKER_JOURNAL_PROBE_RESOURCE_NOT_RUNNING_AFTER_HOST_EXIT');
  await stopJournaledDocker(cold,hash,image);
  const receipt=(await cold.store.readFresh<DockerInvocation>(key)).value,after=await inspect('vb-media-'+record.invocation);
  if(receipt.state!=='stopped'||after?.State.Running)throw Error('DOCKER_JOURNAL_PROBE_STOP_NOT_CONFIRMED');
  let replayCode='';try{await runOwnedDocker(args,90000,image,undefined,cold)}catch(error){replayCode=error instanceof Error?error.message:''}
  if(replayCode!=='MEDIA_EXECUTION_INTERRUPTED')throw Error('DOCKER_JOURNAL_PROBE_REPLAY_NOT_FENCED');
  if(control!==(await source.readFresh(prefix+'/control')).etag||budget!==(await source.readFresh(prefix+'/budget')).etag)throw Error('DOCKER_JOURNAL_PROBE_SOURCE_CHANGED');
  const report={executedAt:new Date().toISOString(),status:'pass',root,journalKey:key,invocation:record.invocation,argsSha256:hash,image,containerId:container.Id,hostExit,observationRetries,coldStateBeforeStop:coldRecord.state,runningObservedAfterHostExit:true,stopState:receipt.state,containerRemoved:after===null,replayCode,sourceControlAndBudgetUnchanged:true,providerCalls:0,resultPublished:false,limits:'Actual offline native FFmpeg signal-processing container proves cold owned resource stop after host process SIGKILL. This diagnostic is not authored audio/video, full production cleanup, operation cancellation, media QA or delivery.'};
  await writeFile('docs/engineering/evidence/docker-journal-probe.json',JSON.stringify(report,null,2)+'\n');process.stdout.write(JSON.stringify({status:report.status,runningObservedAfterHostExit:true,stopState:receipt.state,containerRemoved:after===null,replayCode})+'\n');
 }finally{if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL')}
}
main().catch(error=>{process.stderr.write((error instanceof Error?error.message:'DOCKER_JOURNAL_PROBE_FAILED')+'\n');process.exitCode=1});
