import {randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {z} from 'zod';
import type {AtomicStore} from '@/services/video/storage/atomic-store';
import {StoreConflict,updateJson} from '@/services/video/storage/atomic-store';
import {canonicalHash} from '@/services/video/domain/hash';

export interface DockerJournal{store:AtomicStore;prefix:string}
const digest=z.string().regex(/^[a-f0-9]{64}$/),imageSchema=z.string().regex(/^sha256:[a-f0-9]{64}$/);
const RecordSchema=z.strictObject({schemaVersion:z.literal(1),invocation:z.uuid(),image:imageSchema,argsSha256:digest,state:z.enum(['started','completed','stopped','unknown']),output:z.string().max(1024*1024).optional()}).superRefine((record,ctx)=>{if((record.state==='completed')!==(record.output!==undefined))ctx.addIssue({code:'custom',message:'Completion output must be fixed'})});
export type DockerInvocation=z.infer<typeof RecordSchema>;
export function dockerArgumentsHash(args:string[],image:string){return canonicalHash({args,image})}
function key(journal:DockerJournal,hash:string){
 if(!/^projects\/[a-f0-9-]{36}\/operations\/[a-f0-9-]{36}\/media-effects$/.test(journal.prefix)||!digest.safeParse(hash).success)throw Error('MEDIA_JOURNAL_INVALID');
 return journal.prefix+'/'+hash;
}
function verify(raw:unknown,hash:string,image:string){const parsed=RecordSchema.safeParse(raw);if(!parsed.success||parsed.data.argsSha256!==hash||parsed.data.image!==image)throw Error('MEDIA_JOURNAL_CHANGED');return parsed.data}
export async function readDockerInvocation(journal:DockerJournal,argsSha256:string,image:string){return verify((await journal.store.readFresh(key(journal,argsSha256))).value,argsSha256,image)}
export async function reserveDockerInvocation(journal:DockerJournal,args:string[],image:string):Promise<DockerInvocation>{
 if(!imageSchema.safeParse(image).success||args[0]!=='run'||!args.includes('--rm')||args.some(arg=>arg==='--name'||arg.startsWith('--name=')||arg==='--restart'||arg.startsWith('--restart=')||arg.startsWith('videobuddy.')))throw Error('MEDIA_JOURNAL_INVALID');
 const argsSha256=dockerArgumentsHash(args,image),record:DockerInvocation={schemaVersion:1,invocation:randomUUID(),image,argsSha256,state:'started'};
 try{await journal.store.create(key(journal,argsSha256),record);return record}catch(error){if(!(error instanceof StoreConflict))throw Error('MEDIA_STOP_UNKNOWN',{cause:error})}
 const saved=await readDockerInvocation(journal,argsSha256,image).catch(error=>{throw Error('MEDIA_STOP_UNKNOWN',{cause:error})});
 if(saved.state==='completed')return saved;
 throw Error(saved.state==='stopped'?'MEDIA_EXECUTION_INTERRUPTED':'MEDIA_STOP_UNKNOWN');
}
export async function finishDockerInvocation(journal:DockerJournal,record:DockerInvocation,state:'completed'|'stopped'|'unknown',output?:string){
 return updateJson(journal.store,key(journal,record.argsSha256),(raw:unknown)=>{
  const saved=verify(raw,record.argsSha256,record.image);if(saved.invocation!==record.invocation)throw Error('MEDIA_JOURNAL_CHANGED');
  if(saved.state==='completed'||saved.state==='stopped'){
   if(state==='completed'&&(saved.state!=='completed'||saved.output!==output))throw Error('MEDIA_JOURNAL_CHANGED');
   return saved;
  }
  return RecordSchema.parse({...saved,state,...(state==='completed'?{output}:{})});
 });
}
async function command(args:string[]){
 const child=spawn('docker',args,{stdio:['ignore','pipe','ignore'],signal:AbortSignal.timeout(15000)}),chunks:Buffer[]=[];let size=0;
 child.stdout.on('data',(chunk:Buffer)=>{size+=chunk.length;if(size<=2048)chunks.push(chunk)});
 const code=await new Promise<number>((resolve,reject)=>{child.once('error',reject);child.once('close',value=>resolve(value??1))});
 if(code!==0||size>2048)throw Error('MEDIA_STOP_UNKNOWN');return Buffer.concat(chunks).toString('utf8').trim();
}
/** Cold reconciliation never starts a container. Absence without a fixed
 * completion/stop receipt is inconclusive: a previous client may still start.
 * Only the warm executor may attest its attached client's normal zero exit. */
export async function stopJournaledDocker(journal:DockerJournal,argsSha256:string,image:string,completedAttachedRun?:()=>boolean){
 const record=await readDockerInvocation(journal,argsSha256,image).catch(error=>{throw Error('MEDIA_STOP_UNKNOWN',{cause:error})});
 if(record.state==='completed'||record.state==='stopped')return record;
 const name='vb-media-'+record.invocation;
 async function inspect(){
  let identity:string;
  try{identity=await command(['inspect','--format','{{.Id}} {{.Image}} {{index .Config.Labels "videobuddy.invocation"}} {{index .Config.Labels "videobuddy.arguments"}} {{.State.Running}} {{.State.Status}} {{.HostConfig.RestartPolicy.Name}}',name])}
  catch{const matches=await command(['ps','--all','--quiet','--no-trunc','--filter','name=^/'+name+'$']);if(matches)throw Error('MEDIA_STOP_UNKNOWN');return null}
  const [id,actualImage,invocation,hash,running,status,restart,...extra]=identity.split(' ');
  if(!digest.safeParse(id).success||actualImage!==image||invocation!==record.invocation||hash!==argsSha256||!['true','false'].includes(running)||restart!=='no'||extra.length||running==='false'&&status!=='exited'||running==='true'&&!['running','paused'].includes(status))throw Error('MEDIA_STOP_UNKNOWN');
  return{id,running:running==='true'};
 }
 try{
  const before=await inspect();if(!before&&!completedAttachedRun?.())throw Error('MEDIA_STOP_UNKNOWN');
  if(before?.running){await command(['stop','--time','10',before.id]);const after=await inspect();if(after&&(after.id!==before.id||after.running))throw Error('MEDIA_STOP_UNKNOWN')}
  return await finishDockerInvocation(journal,record,'stopped');
 }catch(error){
  const saved=await readDockerInvocation(journal,argsSha256,image).catch(()=>undefined);
  if(saved?.invocation===record.invocation&&(saved.state==='completed'||saved.state==='stopped'))return saved;
  await finishDockerInvocation(journal,record,'unknown');throw Error('MEDIA_STOP_UNKNOWN',{cause:error});
 }
}
