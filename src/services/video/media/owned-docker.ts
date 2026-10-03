import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {reserveDockerInvocation,finishDockerInvocation,readDockerInvocation,stopJournaledDocker,type DockerJournal} from './docker-journal';

export async function runOwnedDocker(args:string[],timeoutMs:number,image:string,assertActive?:()=>Promise<void>,journal?:DockerJournal){
 await assertActive?.();
 const record=journal?await reserveDockerInvocation(journal,args,image):undefined;
 if(record?.state==='completed'){await assertActive?.();return record.output!}
 if(journal&&record)try{await assertActive?.()}catch(error){await finishDockerInvocation(journal,record,'stopped');throw error}
 const invocation=record?.invocation||randomUUID(),name='vb-media-'+invocation;
 const child=spawn('docker',[...args.slice(0,1),'--name',name,'--label','videobuddy.invocation='+invocation,...(record?['--label','videobuddy.arguments='+record.argsSha256]:[]),...args.slice(1)],{stdio:['ignore','pipe','pipe'],signal:AbortSignal.timeout(timeoutMs)}),errors:Buffer[]=[],output:Buffer[]=[];let size=0,outputSize=0;
 child.stderr.on('data',(part:Buffer)=>{size+=part.length;if(size<=8192)errors.push(part)});
 let closed=false,exitCode:number|null|undefined,interruption:unknown,pending=Promise.resolve();child.once('close',(code:number|null)=>{closed=true;exitCode=code});
 async function command(commandArgs:string[]){
  const task=spawn('docker',commandArgs,{stdio:['ignore','pipe','ignore'],signal:AbortSignal.timeout(15000)}),chunks:Buffer[]=[];
  task.stdout.on('data',(chunk:Buffer)=>{if(Buffer.concat(chunks).length<2048)chunks.push(chunk)});
  const code=await new Promise<number>((resolve,reject)=>{task.once('error',reject);task.once('close',value=>resolve(value??1))});
  if(code!==0)throw Error('MEDIA_STOP_UNKNOWN');return Buffer.concat(chunks).toString('utf8').trim();
 }
 let stopPromise:Promise<void>|undefined;
 function stop(){return stopPromise??=stopOnce()}
 async function stopOnce(){
  if(journal&&record){await stopJournaledDocker(journal,record.argsSha256,image,()=>closed&&exitCode===0);return}
  const deadline=Date.now()+5000;
  while(Date.now()<deadline){
   const identity=await command(['inspect','--format','{{.Id}} {{.Image}} {{index .Config.Labels "videobuddy.invocation"}}',name]).catch(async()=>{
    // An inspect error is not evidence of absence: the daemon may be unreachable.
    const matches=await command(['ps','--all','--quiet','--no-trunc','--filter','name=^/'+name+'$']);
    if(matches)throw Error('MEDIA_STOP_UNKNOWN');return null;
   });
   if(identity){const [id,actualImage,label]=identity.split(' ');if(actualImage!==image||label!==invocation)throw Error('MEDIA_STOP_UNKNOWN');await command(['stop','--time','10',id]);return}
   if(closed&&typeof exitCode==='number')return;
   await new Promise(resolve=>setTimeout(resolve,100));
  }
  throw Error('MEDIA_STOP_UNKNOWN');
 }
 const monitor=assertActive?setInterval(()=>{pending=pending.then(async()=>{if(interruption||closed)return;try{await assertActive()}catch(error){interruption=error;await stop()}}).catch(error=>{interruption=error})},500):undefined;
 child.stdout.on('data',(part:Buffer)=>{outputSize+=part.length;if(outputSize<=1024*1024)output.push(part);else if(!interruption){interruption=Error('MEDIA_OUTPUT_LIMIT');pending=pending.then(()=>stop()).catch(error=>{interruption=Error('MEDIA_STOP_UNKNOWN',{cause:error})})}});
 try{
  const code=await new Promise<number>((resolve,reject)=>{child.once('error',reject);child.once('close',value=>resolve(value??1))});
  if(monitor)clearInterval(monitor);await pending;
  if(interruption)throw interruption;
  if(code!==0)throw Error(`MEDIA_EXECUTION_FAILED: docker exit ${code}; ${Buffer.concat(errors).toString('utf8').slice(0,300)}`);
  await assertActive?.();
  const result=Buffer.concat(output).toString('utf8').trim();
  if(journal&&record)await finishDockerInvocation(journal,record,'completed',result);
  return result;
  }catch(error){
   if(journal&&record){
    const saved=await readDockerInvocation(journal,record.argsSha256,image).catch(()=>undefined);
    if(saved?.invocation===record.invocation&&saved.state==='completed'){await assertActive?.();return saved.output!}
    if(saved?.invocation===record.invocation&&saved.state==='stopped')throw error;
   }
   try{await stop()}catch(stopError){throw Error('MEDIA_STOP_UNKNOWN',{cause:stopError})}
   throw error;
  }
 finally{if(monitor)clearInterval(monitor);await pending}
}
