import{readdir}from'node:fs/promises';import{join}from'node:path';
import{AtomicStore,createOrRead,updateJson}from'@/services/video/storage/atomic-store';
import {StoreMissing} from '@/services/video/storage/atomic-store';
import type {ProjectControl} from '@/contracts/video/project';
import type {PreviewOperation} from '@/services/video/preview/prepare';
import {canonicalHash} from '@/services/video/domain/hash';
import {bindReservedExportCommand} from '@/services/video/exports/intent';
import type {ExportOperation} from '@/services/video/exports/operation';
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
 async reconcileRenders(){
  let failure:unknown;
  const dirs=await readdir(join(this.root,'projects'),{withFileTypes:true}).catch(error=>{if((error as NodeJS.ErrnoException).code==='ENOENT')return[];throw error});
  for(const dir of dirs){if(!dir.isDirectory()||!/^[a-f0-9-]{36}$/.test(dir.name))continue;
   try{
    let c:ProjectControl;try{c=(await this.store.readFresh<ProjectControl>(`projects/${dir.name}/control`)).value}catch(error){if(error instanceof StoreMissing)continue;throw error}
    if(!this.store.listKeys)throw Error('QUEUE_INVENTORY_UNAVAILABLE');
    const live=new Set([c.activeProduction,c.cancelRequestedProductionId,...Object.keys(c.renderOutcomes||{})].filter(Boolean));
    for(const key of await this.store.listKeys(`projects/${dir.name}/operations`,1)){
     try{
      const id=key.split('/').at(-1)!;if(!/^[a-f0-9-]{36}$/.test(id))continue;
      const op=(await this.store.readFresh<{id:string;projectId:string;kind:string;status:string}>(key)).value;
      if(op.kind!=='render')continue;if(op.id!==id||op.projectId!==dir.name)throw Error('QUEUE_RECORD_INVALID');
      // Never dispatch an orphan reservation before its approval CAS commits.
      if(live.has(id)||['succeeded','failed','cancelled','cancelling','superseded'].includes(op.status))await this.enqueue(dir.name,id,'render');
     }catch(error){failure ||= error}
    }
   }catch(error){failure ||= error}
  }
  return failure;
 }
 async reconcileExports(){
  let failure:unknown;
  const dirs=await readdir(join(this.root,'projects'),{withFileTypes:true}).catch(error=>{if((error as NodeJS.ErrnoException).code==='ENOENT')return[];throw error});
  for(const dir of dirs){if(!dir.isDirectory()||!/^[a-f0-9-]{36}$/.test(dir.name))continue;
   try{
    if(!this.store.listKeys)throw Error('QUEUE_INVENTORY_UNAVAILABLE');
    // A request can die after reserving its result slot but before writing the
    // operation file/enqueue. The slot already binds the authorized frozen input.
    for(const key of await this.store.listKeys(`projects/${dir.name}/results`,3)){
     try{
     if(!/\/results\/[a-f0-9-]{36}\/export-requests\/(source_zip|srt|treatment|credits|quality)$/.test(key))continue;
     const reserved=(await this.store.readFresh<ExportOperation>(key)).value;
     if(reserved.projectId!==dir.name||reserved.resultId!==key.split('/')[3]||reserved.format!==key.split('/').at(-1)||reserved.kind!=='export'||!/^[a-f0-9-]{36}$/.test(reserved.id))throw Error('QUEUE_RECORD_INVALID');
     await bindReservedExportCommand(this.store,reserved);
     await createOrRead(this.store,`projects/${dir.name}/operations/${reserved.id}`,reserved);
     }catch(error){failure ||= error}
    }
    for(const key of await this.store.listKeys(`projects/${dir.name}/operations`,1)){
     const id=key.split('/').at(-1)!;if(!/^[a-f0-9-]{36}$/.test(id))continue;
     const op=(await this.store.readFresh<{id:string;projectId:string;kind:string;status:string}>(key)).value;
     if(op.kind==='export'&&op.id===id&&op.projectId===dir.name&&['reserved','running','cancelling','cancelled','failed','interrupted','superseded','succeeded'].includes(op.status))await this.enqueue(dir.name,id,'export');
    }
   }catch(error){failure ||= error}
  }
  return failure;
 }
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
