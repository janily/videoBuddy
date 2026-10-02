import{readdir}from'node:fs/promises';import{join}from'node:path';
import{AtomicStore,createOrRead,updateJson}from'@/services/video/storage/atomic-store';
export type QueuedOperation={projectId:string;operationId:string;kind:string};
interface RecordValue extends QueuedOperation{status:'queued'|'done'}
export class LocalOperationQueue{
 constructor(private store:AtomicStore,private root:string){}
 key(projectId:string,operationId:string){if(!/^[a-f0-9-]{36}$/.test(projectId)||!/^[a-f0-9-]{36}$/.test(operationId))throw Error('INVALID_KEY');return`queue/${projectId}/${operationId}`}
 async enqueue(projectId:string,operationId:string,kind:string){const key=this.key(projectId,operationId),current=await createOrRead(this.store,key,{projectId,operationId,kind,status:'queued' as const});if(current.kind!==kind)throw Error('IDEMPOTENCY_CONFLICT');return current}
 async complete(projectId:string,operationId:string){await updateJson(this.store,this.key(projectId,operationId),(value:RecordValue)=>({...value,status:'done' as const}))}
 async pending():Promise<QueuedOperation[]>{
  let projects;try{projects=await readdir(join(this.root,'queue'),{withFileTypes:true})}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return[];throw error}
  const result:QueuedOperation[]=[];
  for(const project of projects){if(!project.isDirectory()||!/^[a-f0-9-]{36}$/.test(project.name))continue;
   const files=await readdir(join(this.root,'queue',project.name),{withFileTypes:true});
   for(const file of files){if(!file.isFile()||!file.name.endsWith('.json'))continue;const operationId=file.name.slice(0,-5);if(!/^[a-f0-9-]{36}$/.test(operationId))continue;
    const value=(await this.store.readFresh<RecordValue>(this.key(project.name,operationId))).value;
    if(value.status==='queued'&&value.projectId===project.name&&value.operationId===operationId)result.push({projectId:value.projectId,operationId:value.operationId,kind:value.kind});
   }
  }
  return result.sort((a,b)=>a.projectId.localeCompare(b.projectId)||a.operationId.localeCompare(b.operationId));
 }
}
