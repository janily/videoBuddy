import {randomUUID} from 'node:crypto';
import {AtomicStore,createOrRead,updateJson} from '@/services/video/storage/atomic-store';
import {canonicalHash} from '@/services/video/domain/hash';
export interface Receipt{schemaVersion:5;commandId:string;projectId:string;operationId:string;controlVersion:number;status:'reserved'|'accepted'|'replayed'|'completed'}
interface Control{controlVersion:number;receipts:Receipt[];activeConversation?:string|null;activeProduction?:string|null}
export interface CommandIntent{hash:string;receipt:Receipt;kind:string;body:Record<string,unknown>}
export class StartFailed extends Error{code='START_FAILED';constructor(public receipt:Receipt){super('START_FAILED')}}
export class CommandService{
 constructor(private store:AtomicStore,private start:(projectId:string,operationId:string,kind:string)=>Promise<{runId:string}>){}
 async submit(projectId:string,kind:string,body:Record<string,unknown>):Promise<Receipt>{
  const id=body.clientCommandId;if(typeof id!=='string')throw Error('VALIDATION_FAILED');
  const key=`projects/${projectId}/commands/${id}`;const hash=canonicalHash({kind,body});
  const initial:CommandIntent={hash,kind,body,receipt:{schemaVersion:5,commandId:id,projectId,operationId:randomUUID(),controlVersion:0,status:'reserved'}};
  const intent=await createOrRead(this.store,key,initial);
  if(intent.hash!==hash)throw Error('IDEMPOTENCY_CONFLICT');
  const lane=kind==='chat'||kind==='asset_analysis'?'activeConversation':'activeProduction';
  const control=await updateJson(this.store,`projects/${projectId}/control`,(c:Control)=>{
   if(c.receipts.some(r=>r.commandId===id))return c;
   if(c[lane])throw Error('BUSY');
   return {...c,[lane]:intent.receipt.operationId,controlVersion:c.controlVersion+1,receipts:[...c.receipts.slice(-127),{...intent.receipt,controlVersion:c.controlVersion+1}]};
  });
  const receipt=control.receipts.find(r=>r.commandId===id)!;
  if(receipt.status!=='reserved')return {...receipt,status:'replayed'};
  await createOrRead(this.store,`projects/${projectId}/operations/${receipt.operationId}`,{id:receipt.operationId,projectId,commandId:id,kind,status:'reserved',canonicalRunId:null,streamEpoch:0,fence:0,inputHash:hash});
  try{await this.start(projectId,receipt.operationId,kind)}catch{throw new StartFailed(receipt)}
  const accepted={...receipt,status:'accepted' as const};
  await updateJson(this.store,`projects/${projectId}/control`,(c:Control)=>({...c,controlVersion:c.controlVersion+1,receipts:c.receipts.map(r=>r.commandId===id?accepted:r)}));
  return accepted;
 }
}
