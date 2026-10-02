import {createHash} from 'node:crypto';
import {AtomicStore,createOrRead} from './atomic-store';
import type {ObjectRef} from '@/contracts/video/domain';
import {canonicalJson} from '@/services/video/domain/hash';
export interface IndexEntry{id:string;ordinal:number;ref:ObjectRef}
interface IndexRoot{chunks:ObjectRef[];count:number}
export class IndexStore{
 constructor(private store:AtomicStore){}
 async immutable<T>(prefix:string,value:T):Promise<ObjectRef>{const body=canonicalJson(value),sha256=createHash('sha256').update(body).digest('hex');const key=`${prefix}/${sha256}`;await createOrRead(this.store,key,value);return{key,sha256,bytes:Buffer.byteLength(body),mime:'application/json'}}
 async all(rootRef:ObjectRef):Promise<IndexEntry[]>{const root=(await this.store.readFresh<IndexRoot>(rootRef.key)).value;return(await Promise.all(root.chunks.map(async ref=>(await this.store.readFresh<IndexEntry[]>(ref.key)).value))).flat()}
 async empty(prefix:string){return this.immutable(prefix,{chunks:[],count:0})}
 async append(prefix:string,rootRef:ObjectRef,entry:IndexEntry,max=1000){
  const current=await this.all(rootRef);const existing=current.findIndex(e=>e.id===entry.id);
  if(existing>=0)current[existing]=entry;else {if(current.length>=max)throw Error('MESSAGE_LIMIT');current.push(entry)}
  current.sort((a,b)=>a.ordinal-b.ordinal);const chunks:ObjectRef[]=[];
  for(let i=0;i<current.length;i+=100)chunks.push(await this.immutable(`${prefix}/chunks`,current.slice(i,i+100)));
  return this.immutable(prefix,{count:current.length,chunks});
 }
}
