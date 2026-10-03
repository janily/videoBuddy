import {z} from 'zod';
import {DeleteProjectRequestSchema,type DeleteProjectRequest} from '@/contracts/video/commands';
import type {ProjectControl} from '@/contracts/video/project';
import {createOrRead,updateJson,type AtomicStore} from '@/services/video/storage/atomic-store';
import {canonicalHash} from '@/services/video/domain/hash';

const terminal=new Set(['succeeded','failed','cancelled','interrupted','superseded']);
const OperationSchema=z.object({id:z.uuid(),projectId:z.uuid(),status:z.enum(['reserved','queued','running','cancelling','succeeded','failed','cancelled','interrupted','superseded']),fence:z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),canonicalRunId:z.string().nullable()});

// Cancellation progress is not proof that containers, effects or files are gone.
// Keep the tombstone and accounting until the separate resource cleanup completes.
export async function reconcileDeletedProject(store:AtomicStore,projectId:string){
 if(!z.uuid().safeParse(projectId).success)throw Error('VALIDATION_FAILED');
 const prefix=`projects/${projectId}`,control=(await store.readFresh<ProjectControl>(`${prefix}/control`)).value;
 if(control.projectId!==projectId||!control.deletedAt)throw Error('DELETION_RECORD_INVALID');
 if(!store.listKeys)throw Error('DELETION_INVENTORY_UNAVAILABLE');
 let operationsPending=0;
 for(const key of await store.listKeys(`${prefix}/operations`,1)){
  const id=key.slice(`${prefix}/operations/`.length);
  if(!z.uuid().safeParse(id).success||key!==`${prefix}/operations/${id}`)throw Error('DELETION_RECORD_INVALID');
  const operation=await updateJson(store,key,(current:unknown)=>{
   const parsed=OperationSchema.safeParse(current);
   if(!parsed.success||parsed.data.id!==id||parsed.data.projectId!==projectId)throw Error('DELETION_RECORD_INVALID');
   const op=parsed.data;
   if(terminal.has(op.status)||op.status==='cancelling')return current;
   if(op.fence===Number.MAX_SAFE_INTEGER)throw Error('DELETION_RECORD_INVALID');
   const unclaimed=['reserved','queued'].includes(op.status)&&op.canonicalRunId===null;
   return{...(current as Record<string,unknown>),status:unclaimed?'cancelled':'cancelling',fence:op.fence+1};
  });
  if(!terminal.has(OperationSchema.parse(operation).status))operationsPending++;
 }
 return{status:'cancelling' as const,operationsPending};
}

export async function deleteProject(store:AtomicStore,owner:string,projectId:string,untrusted:DeleteProjectRequest){
 const request=DeleteProjectRequestSchema.parse(untrusted);
 if(!z.uuid().safeParse(projectId).success)throw Error('VALIDATION_FAILED');
 const prefix=`projects/${projectId}`,key=`${prefix}/control`;
 const assertOwner=(c:ProjectControl)=>{
  if(c.projectId===projectId&&c.ownerKeyHash===owner&&c.expiration)throw Error('PROJECT_EXPIRED');
  if(c.projectId!==projectId||c.ownerKeyHash!==owner||c.deletedAt&&c.deletion?.commandId!==request.clientCommandId)throw Error('ACCESS_NOT_FOUND');
  if(!c.deletedAt&&Date.parse(c.expiresAt)<=Date.now())throw Error('PROJECT_EXPIRED');
 };
 assertOwner((await store.readFresh<ProjectControl>(key)).value);
 const hash=canonicalHash({kind:'delete_project',body:request});
 const intent=await createOrRead(store,`${prefix}/commands/${request.clientCommandId}`,{hash});
 if(intent.hash!==hash)throw Error('IDEMPOTENCY_CONFLICT');
 const control=await updateJson(store,key,(c:ProjectControl)=>{
  assertOwner(c);if(c.deletedAt)return c;
  if(!Number.isSafeInteger(c.controlVersion)||c.controlVersion>=Number.MAX_SAFE_INTEGER||!Number.isSafeInteger(c.consentEpoch)||c.consentEpoch>=Number.MAX_SAFE_INTEGER)throw Error('DELETION_RECORD_INVALID');
  const deletion={schemaVersion:5 as const,commandId:request.clientCommandId,projectId,controlVersion:c.controlVersion+1,status:'cancelling' as const};
  return{...c,deletion,deletedAt:new Date().toISOString(),controlVersion:deletion.controlVersion,consentEpoch:c.consentEpoch+1,activeConversation:null,activeProduction:null};
 });
 await reconcileDeletedProject(store,projectId);
 return control.deletion!;
}

// Restart recovery uses the persisted tombstone, never a new user command.
export async function reconcileDeletedProjects(store:AtomicStore){
 if(!store.listKeys)throw Error('DELETION_INVENTORY_UNAVAILABLE');
 let reconciled=0,failed=0;
 for(const key of await store.listKeys('projects',2)){
  const match=key.match(/^projects\/([^/]+)\/control$/);
  if(!match||!z.uuid().safeParse(match[1]).success)continue;
  try{
   const control=(await store.readFresh<ProjectControl>(key)).value;
   if(!control.deletedAt)continue;
   await reconcileDeletedProject(store,match[1]);reconciled++;
  }catch{failed++}
 }
 return{reconciled,failed};
}
