import {spawn} from 'node:child_process';
import {mkdirSync,watch} from 'node:fs';
import {join,isAbsolute,dirname} from 'node:path';
import {StreamEvent,StreamEventSchema} from '@/contracts/video/commands';
interface PythonResult{ok?:boolean;error?:string;index?:number;tailIndex?:number;events?:{index:number;event:unknown}[]}
export class LocalEventLog{
 constructor(private root:string){if(!isAbsolute(root))throw Error('CONFIGURATION_REQUIRED: VIDEO_DATA_DIR')}
 path(projectId:string,operationId:string){if(!/^[a-f0-9-]{36}$/.test(projectId)||!/^[a-f0-9-]{36}$/.test(operationId))throw Error('INVALID_KEY');return join(this.root,'streams',projectId,operationId+'.jsonl')}
 private async call(payload:Record<string,unknown>):Promise<PythonResult>{
  const python=process.env.VIDEO_PYTHON_PATH||'python3',script=join(process.cwd(),'runtime/storage/event_log.py');
  const child=spawn(/* turbopackIgnore: true */ python,[script,this.root],{stdio:['pipe','pipe','pipe']});const output:Buffer[]=[];
  child.stdout.on('data',(part:Buffer)=>output.push(part));
  const exit=new Promise<number>((resolve,reject)=>{child.once('error',reject);child.once('close',code=>resolve(code??1))});
  child.stdin.end(JSON.stringify(payload));const code=await exit;
  let parsed:PythonResult;try{parsed=JSON.parse(Buffer.concat(output).toString('utf8'))}catch{throw Error('STORE_IO_FAILED')}
  if(code!==0||parsed.error)throw Error(parsed.error||'STORE_IO_FAILED');return parsed;
 }
 async append(event:StreamEvent){const value=StreamEventSchema.parse(event);this.path(value.projectId,value.operationId);
  const result=await this.call({op:'append',projectId:value.projectId,operationId:value.operationId,event:JSON.stringify(value)});return result.index!;
 }
 async readFrom(projectId:string,operationId:string,startIndex:number):Promise<{index:number;event:StreamEvent}[]>{
  this.path(projectId,operationId);if(!Number.isSafeInteger(startIndex)||startIndex<0)throw Error('CURSOR_INVALID');
  const result=await this.call({op:'read',projectId,operationId,startIndex});return(result.events||[]).map(item=>({index:item.index,event:StreamEventSchema.parse(item.event)}));
 }
 async tailIndex(projectId:string,operationId:string){const result=await this.call({op:'read',projectId,operationId,startIndex:Number.MAX_SAFE_INTEGER});return result.tailIndex??-1}
 follow(projectId:string,operationId:string,startIndex:number):ReadableStream<{index:number;event:StreamEvent}>{
  const path=this.path(projectId,operationId);let next=startIndex,watcher:ReturnType<typeof watch>|null=null,timer:ReturnType<typeof setInterval>|null=null,closed=false,busy=false;
  mkdirSync(dirname(path),{recursive:true});
  const close=()=>{closed=true;watcher?.close();if(timer)clearInterval(timer)};
  return new ReadableStream({start:controller=>{
   const pump=async()=>{if(closed||busy)return;busy=true;try{for(const item of await this.readFrom(projectId,operationId,next)){if(closed)break;controller.enqueue(item);next=item.index+1}}catch(error){close();controller.error(error)}finally{busy=false}};
   try{watcher=watch(dirname(path),pump)}catch{/* Heartbeat fallback reads the durable log. */}
   timer=setInterval(pump,15000);void pump();
  },cancel:close});
 }
}
