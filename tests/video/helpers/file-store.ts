// Test-only durable adapter. Never selected by production environment config.
import {mkdir,readFile,writeFile,rename,unlink,open} from 'node:fs/promises';
import {dirname,join} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {AtomicStore,StoreConflict,StoreMissing} from '@/services/video/storage/atomic-store';
export class FileStore implements AtomicStore{
 constructor(private root:string){}
 path(key:string){if(!/^[a-zA-Z0-9/_-]+$/.test(key))throw Error('INVALID_KEY');return join(this.root,key+'.json')}
 async readFresh<T>(key:string){try{const body=await readFile(this.path(key));return {value:JSON.parse(body.toString()) as T,etag:createHash('sha256').update(body).digest('hex')}}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')throw new StoreMissing();throw e}}
 async locked(key:string,fn:()=>Promise<void>){const path=this.path(key);await mkdir(dirname(path),{recursive:true});let handle;for(let attempt=0;attempt<100;attempt++){try{handle=await open(path+'.lock','wx');break}catch(e){if((e as NodeJS.ErrnoException).code!=='EEXIST')throw e;await new Promise(resolve=>setTimeout(resolve,2))}}if(!handle)throw new StoreConflict();try{await fn()}finally{await handle.close();await unlink(path+'.lock')}}
 async create<T>(key:string,value:T){await this.locked(key,async()=>{try{await readFile(this.path(key));throw new StoreConflict()}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e}await this.replace(key,value)})}
 async cas<T>(key:string,etag:string,value:T){await this.locked(key,async()=>{if((await this.readFresh(key)).etag!==etag)throw new StoreConflict();await this.replace(key,value)})}
 async replace<T>(key:string,value:T){const temp=this.path(key)+'.'+randomUUID();await writeFile(temp,JSON.stringify(value));await rename(temp,this.path(key))}
}
