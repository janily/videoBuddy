import{readdir}from'node:fs/promises';import{join}from'node:path';
import{AtomicStore,createOrRead,updateJson}from'@/services/video/storage/atomic-store';
import {StoreMissing} from '@/services/video/storage/atomic-store';
import type {ProjectControl} from '@/contracts/video/project';
import type {PreviewOperation} from '@/services/video/preview/prepare';
import {canonicalHash} from '@/services/video/domain/hash';
export type QueuedOperation={projectId:string;operationId:string;kind:string};
interface RecordValue extends QueuedOperation{status:'queued'|'done'}
export class LocalOperationQueue{
 constructor(private store:AtomicStore,private root:string){}
 key(projectId:string,operationId:string){if(!/^[a-f0-9-]{36}$/.test(projectId)||!/^[a-f0-9-]{36}$/.test(operationId))throw Error('INVALID_KEY');return`queue/${projectId}/${operationId}`}
 async enqueue(projectId:string,operationId:string,kind:string){const key=this.key(projectId,operationId),current=await createOrRead(this.store,key,{projectId,operationId,kind,status:'queued' as const});if(current.kind!==kind)throw Error('IDEMPOTENCY_CONFLICT');return current}
 async complete(projectId:string,operationId:string){await updateJson(this.store,this.key(projectId,operationId),(value:RecordValue)=>({...value,status:'done' as const}))}
 async reconcilePreviews(){
  let failure:unknown;
  const dirs=await readdir(join(this.root,'projects'),{withFileTypes:true}).catch(error=>{if((error as NodeJS.ErrnoException).code==='ENOENT')return[];throw error});
  for(const dir of dirs){
   if(!dir.isDirectory()||!/^[a-f0-9-]{36}$/.test(dir.name))continue;
   try{
   let c:ProjectControl;try{c=(await this.store.readFresh<ProjectControl>(`projects/${dir.name}/control`)).value}catch(error){if(error instanceof StoreMissing)continue;throw error}
   const removable=[] as string[];
   for(const [id,outcome] of Object.entries(c.previewOutcomes||{})){
    const key=`projects/${dir.name}/operations/${id}`,op=(await this.store.readFresh<{status:string}>(key)).value;
    if(!['succeeded','failed','cancelled','superseded'].includes(op.status))continue;
    const saved=(await this.store.readFresh(key+'/preview-outcome')).value;
    if(canonicalHash(saved)===canonicalHash(outcome))removable.push(id);
   }
   if(removable.length)c=await updateJson(this.store,`projects/${dir.name}/control`,(current:ProjectControl)=>{
    const remaining={...current.previewOutcomes};for(const id of removable)if(canonicalHash(remaining[id])===canonicalHash(c.previewOutcomes![id]))delete remaining[id];
    return{...current,controlVersion:current.controlVersion+1,previewOutcomes:remaining};
   });
   const id=c.activeProduction||c.cancelRequestedProductionId;
   if(c.deletedAt||Date.parse(c.expiresAt)<=Date.now()||!id)continue;
   const op=(await this.store.readFresh<PreviewOperation>(`projects/${dir.name}/operations/${id}`)).value;
   if(op.kind!=='preview'||op.id!==id||op.projectId!==dir.name||!['reserved','running','cancelling'].includes(op.status))continue;
   const live=c.phase==='preparing_preview'&&c.activeProduction===id&&c.briefVersion===op.briefVersion&&c.consentEpoch===op.consentEpoch&&canonicalHash(c.understandingRef)===canonicalHash(op.understandingRef);
   if(live||c.cancelRequestedProductionId===id)await this.enqueue(dir.name,id,'preview');
   }catch(error){failure ||= error}
  }
  return failure;
 }
 async pending():Promise<QueuedOperation[]>{const value=await this.pendingWithFailures();if(value.failure)throw value.failure;return value.jobs}
 async pendingWithFailures():Promise<{jobs:QueuedOperation[];failure?:Error}>{
  let projects;try{projects=await readdir(join(this.root,'queue'),{withFileTypes:true})}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return{jobs:[]};throw error}
  const result:QueuedOperation[]=[];let failure:Error|undefined;
  for(const project of projects){if(!project.isDirectory()||!/^[a-f0-9-]{36}$/.test(project.name))continue;
   const files=await readdir(join(this.root,'queue',project.name),{withFileTypes:true});
   for(const file of files){if(!file.isFile()||!file.name.endsWith('.json'))continue;const operationId=file.name.slice(0,-5);if(!/^[a-f0-9-]{36}$/.test(operationId))continue;
    try{
    const value=(await this.store.readFresh<RecordValue>(this.key(project.name,operationId))).value;
    if(!value||!['queued','done'].includes(value.status)||typeof value.kind!=='string'||!value.kind||value.projectId!==project.name||value.operationId!==operationId)throw Error('QUEUE_RECORD_INVALID');
    if(value.status==='queued'&&value.projectId===project.name&&value.operationId===operationId)result.push({projectId:value.projectId,operationId:value.operationId,kind:value.kind});
    }catch{failure ||= Error('QUEUE_RECORD_INVALID')}
   }
  }
  return{jobs:result.sort((a,b)=>a.projectId.localeCompare(b.projectId)||a.operationId.localeCompare(b.operationId)),failure};
 }
}
