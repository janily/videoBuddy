import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import {isAbsolute,join} from 'node:path';
import {AtomicStore,StoreConflict,StoreMissing} from './atomic-store';

interface Result {ok?:boolean;error?:string}
export class FileStore implements AtomicStore {
 constructor(private readonly root:string){if(!isAbsolute(root))throw Error('CONFIGURATION_REQUIRED: VIDEO_DATA_DIR must be absolute')}
 path(key:string){if(!/^[A-Za-z0-9/_-]+$/.test(key)||key.split('/').some(part=>!part))throw Error('INVALID_KEY');return join(this.root,key+'.json')}
 async readFresh<T>(key:string):Promise<{value:T;etag:string}>{
  let body:Buffer;try{body=await readFile(this.path(key))}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')throw new StoreMissing();throw error}
  return{value:JSON.parse(body.toString('utf8')) as T,etag:createHash('sha256').update(body).digest('hex')};
 }
 private async mutate<T>(op:'create'|'cas',key:string,value:T,etag?:string){
  this.path(key);const serialized=JSON.stringify(value);if(typeof serialized!=='string')throw Error('INVALID_STATE');
  const python=process.env.VIDEO_PYTHON_PATH||'python3';const script=join(process.cwd(),'runtime/storage/state_store.py');
  const child=spawn(/* turbopackIgnore: true */ python,[script,this.root],{stdio:['pipe','pipe','pipe']});
  const out:Buffer[]=[];const err:Buffer[]=[];
  child.stdout.on('data',(part:Buffer)=>out.push(part));child.stderr.on('data',(part:Buffer)=>{if(Buffer.concat(err).length<4096)err.push(part)});
  const exited=new Promise<number>((resolve,reject)=>{child.once('error',reject);child.once('close',(code)=>resolve(code??1))});
  child.stdin.end(JSON.stringify({op,key,value:serialized,etag}));
  const code=await exited;let response:Result;try{response=JSON.parse(Buffer.concat(out).toString('utf8'))}catch{throw Error(`STORE_IO_FAILED: child exited ${code}`)}
  if(response.error==='STORE_CONFLICT')throw new StoreConflict();
  if(response.error==='STORE_NOT_FOUND')throw new StoreMissing();
  if(code!==0||!response.ok)throw Error('STORE_IO_FAILED');
 }
 create<T>(key:string,value:T){return this.mutate('create',key,value)}
 cas<T>(key:string,etag:string,value:T){return this.mutate('cas',key,value,etag)}
}
export function productionStore(){const root=process.env.VIDEO_DATA_DIR;if(!root)throw Error('CONFIGURATION_REQUIRED: VIDEO_DATA_DIR');return new FileStore(root)}
