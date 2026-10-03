import {z} from 'zod';
import {AtomicStore,StoreMissing,createOrRead,updateJson} from '@/services/video/storage/atomic-store';
import {canonicalHash} from '@/services/video/domain/hash';
export interface ModelLimits{projectCalls:number;projectInputTokens:number;projectOutputTokens:number;dailyCalls:number}
interface Cost{inputTokens:number;outputTokens:number}
const integer=z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),digest=z.string().regex(/^[a-f0-9]{64}$/);
const usageSchema=z.strictObject({inputTokens:integer,outputTokens:integer});
const entrySchema=z.discriminatedUnion('state',[
 z.strictObject({state:z.literal('started'),startedAt:z.string().datetime()}),
 z.strictObject({state:z.literal('unknown'),startedAt:z.string().datetime()}),
 z.strictObject({state:z.enum(['settled','overrun']),startedAt:z.string().datetime(),inputTokens:integer,outputTokens:integer}),
]);
const counterSchema=z.strictObject({calls:integer,inputTokens:integer,outputTokens:integer,reservations:z.record(digest,digest),accountingVersion:z.literal(2).optional(),accounting:z.record(digest,entrySchema).optional()});
type Counter=z.infer<typeof counterSchema>;
export type ModelUsage=z.infer<typeof usageSchema>;
export interface ModelReservation{projectId:string;stage:string;id:string;day:string;hash:string;cost:Cost}
const empty:Counter={calls:0,inputTokens:0,outputTokens:0,reservations:{},accountingVersion:2};
const gateKey='budgets/model-gate';
const gateSchema=z.strictObject({schemaVersion:z.literal(1),active:z.strictObject({id:digest,projectId:z.string(),day:z.string(),hash:digest,state:z.enum(['started','unknown','overrun']),startedAt:z.string().datetime()}).nullable()});
type Gate=z.infer<typeof gateSchema>;
async function readGate(store:AtomicStore){
 let raw:unknown;
 try{raw=(await store.readFresh(gateKey)).value}catch(error){
  if(!(error instanceof StoreMissing))throw error;
  if(!store.listKeys)throw Error('MODEL_ACCOUNTING_MIGRATION_REQUIRED');
  const inventory=await Promise.all([store.listKeys('budgets/daily',1),store.listKeys('projects',2)]);
  const keys=[...inventory[0],...inventory[1].filter(key=>/^projects\/[A-Za-z0-9_-]+\/budget$/.test(key))];
  for(const key of keys)if(counter((await store.readFresh(key)).value).calls>0){
   // A concurrent fresh initializer may already have committed the gate.
   try{return gate((await store.readFresh(gateKey)).value)}catch(error){if(!(error instanceof StoreMissing))throw error;throw Error('MODEL_ACCOUNTING_MIGRATION_REQUIRED')}
  }
  raw=await createOrRead(store,gateKey,{schemaVersion:1,active:null});
 }
 const parsed=gateSchema.safeParse(raw);
 if(!parsed.success)throw Error('MODEL_ACCOUNTING_INVALID');return parsed.data;
}
function assertGateAvailable(gate:Gate){if(gate.active)throw Error(gate.active.state==='overrun'?'MODEL_BUDGET_OVERRUN':'MODEL_USAGE_UNCERTAIN')}
function gate(raw:unknown){const parsed=gateSchema.safeParse(raw);if(!parsed.success)throw Error('MODEL_ACCOUNTING_INVALID');return parsed.data}
function ownGate(g:Gate,r:ModelReservation){return g.active?.id===r.id&&g.active.hash===r.hash&&g.active.day===r.day&&g.active.projectId===r.projectId}
function counter(raw:unknown){const parsed=counterSchema.safeParse(raw);if(!parsed.success)throw Error('MODEL_ACCOUNTING_INVALID');return parsed.data}
function assertAvailable(c:Counter){
 if(c.accountingVersion!==2&&c.calls>0)throw Error('MODEL_USAGE_UNCERTAIN');
 const states=Object.values(c.accounting||{});
 if(states.some(entry=>entry.state==='overrun'))throw Error('MODEL_BUDGET_OVERRUN');
 if(states.some(entry=>entry.state==='started'||entry.state==='unknown'))throw Error('MODEL_USAGE_UNCERTAIN');
}
function keys(r:ModelReservation){return['budgets/daily/'+r.day,'projects/'+r.projectId+'/budget']}
async function validateReservation(store:AtomicStore,r:ModelReservation){
 if(!r||!/^[A-Za-z0-9_-]{1,120}$/.test(r.projectId)||!r.stage||r.id!==canonicalHash({projectId:r.projectId,stage:r.stage})||r.hash!==canonicalHash(r.cost)||!Object.values(r.cost).every(n=>Number.isSafeInteger(n)&&n>0)||!/^\d{4}-\d{2}-\d{2}$/.test(r.day))throw Error('MODEL_RESERVATION_INVALID');
 const intent=(await store.readFresh<{hash:string;day:string}>('projects/'+r.projectId+'/budget-intents/'+r.id)).value;
 if(intent.hash!==r.hash||intent.day!==r.day)throw Error('MODEL_RESERVATION_INVALID');
 for(const key of keys(r)){const c=counter((await store.readFresh(key)).value);if(c.reservations[r.id]!==r.hash)throw Error('MODEL_RESERVATION_INVALID')}
}
export async function reserveModelBudget(store:AtomicStore,projectId:string,stage:string,cost:Cost,limits:ModelLimits){
 if([...Object.values(limits),...Object.values(cost)].some(n=>!Number.isSafeInteger(n)||n<1))throw Error('CONFIGURATION_REQUIRED');
 const hash=canonicalHash(cost),id=canonicalHash({projectId,stage});
 const intent=await createOrRead(store,'projects/'+projectId+'/budget-intents/'+id,{hash,day:new Date().toISOString().slice(0,10)});
 if(intent.hash!==hash)throw Error('IDEMPOTENCY_CONFLICT');
 async function reserve(key:string,maxCalls:number,inputMax:number,outputMax:number){
  await createOrRead(store,key,empty);
  return updateJson(store,key,async(raw:unknown)=>{
   const c=counter(raw);
   if(c.reservations[id]){if(c.reservations[id]!==hash)throw Error('IDEMPOTENCY_CONFLICT');return c}
   assertGateAvailable(await readGate(store));
   assertAvailable(c);
   if(c.calls+1>maxCalls||c.inputTokens+cost.inputTokens>inputMax||c.outputTokens+cost.outputTokens>outputMax)throw Error('BUDGET_EXCEEDED');
   return{...c,accountingVersion:2 as const,calls:c.calls+1,inputTokens:c.inputTokens+cost.inputTokens,outputTokens:c.outputTokens+cost.outputTokens,reservations:{...c.reservations,[id]:hash}};
  });
 }
 // Never refund an unknown effect or the unused part of a conservative reservation.
 await reserve('budgets/daily/'+intent.day,limits.dailyCalls,Number.MAX_SAFE_INTEGER,Number.MAX_SAFE_INTEGER);
 await reserve('projects/'+projectId+'/budget',limits.projectCalls,limits.projectInputTokens,limits.projectOutputTokens);
 return{maxOutputTokens:cost.outputTokens,reservation:{projectId,stage,id,day:intent.day,hash,cost} satisfies ModelReservation};
}
export async function startModelAttempt(store:AtomicStore,r:ModelReservation){
 await validateReservation(store,r);
 for(const key of keys(r)){const c=counter((await store.readFresh(key)).value);if(c.accounting?.[r.id])throw Error('MODEL_ATTEMPT_ALREADY_STARTED')}
 if(r.day!==new Date().toISOString().slice(0,10))throw Error('MODEL_RESERVATION_EXPIRED');
 const startedAt=new Date().toISOString();
 await readGate(store);
 await updateJson(store,gateKey,(raw:unknown)=>{
  const g=gate(raw);if(ownGate(g,r))throw Error('MODEL_ATTEMPT_ALREADY_STARTED');assertGateAvailable(g);
  return{schemaVersion:1 as const,active:{id:r.id,projectId:r.projectId,day:r.day,hash:r.hash,state:'started' as const,startedAt}};
 });
 try{for(const key of keys(r)){await updateJson(store,key,(raw:unknown)=>{
  const c=counter(raw);
  if(c.accounting?.[r.id])throw Error('MODEL_ATTEMPT_ALREADY_STARTED');
  assertAvailable(c);
  return{...c,accounting:{...c.accounting,[r.id]:{state:'started',startedAt}}};
 })}
  if(r.day!==new Date().toISOString().slice(0,10))throw Error('MODEL_RESERVATION_EXPIRED');
 }
 catch(error){await markModelUsageUnknown(store,r);throw error}
}
export async function markModelUsageUnknown(store:AtomicStore,r:ModelReservation){
 await validateReservation(store,r);
 const snapshots=await Promise.all(keys(r).map(async key=>counter((await store.readFresh(key)).value)));
 const g=await readGate(store),proof=snapshots.map(c=>c.accounting?.[r.id]).find(entry=>entry!==undefined)||(ownGate(g,r)?g.active:undefined);
 if(!proof)throw Error('MODEL_ATTEMPT_NOT_STARTED');
 await updateJson(store,gateKey,(raw:unknown)=>{
  const current=gate(raw);if(!ownGate(current,r)||current.active!.state==='overrun')return current;
  return{...current,active:{...current.active!,state:'unknown' as const}};
 });
 for(const key of keys(r))await updateJson(store,key,(raw:unknown)=>{
  const c=counter(raw),entry=c.accounting?.[r.id];
  if(entry?.state==='settled'||entry?.state==='overrun')return c;
  return{...c,accounting:{...c.accounting,[r.id]:{state:'unknown',startedAt:entry?.startedAt||proof.startedAt}}};
 });
}
export async function settleModelUsage(store:AtomicStore,r:ModelReservation,untrusted:unknown){
 await validateReservation(store,r);
 const parsed=usageSchema.safeParse(untrusted);if(!parsed.success)throw Error('MODEL_USAGE_INVALID');
 const usage=parsed.data,receipt={schemaVersion:1,reservationHash:r.hash,...usage};
 const saved=await createOrRead(store,'projects/'+r.projectId+'/model-usage/'+r.id,receipt);
 if(canonicalHash(saved)!==canonicalHash(receipt))throw Error('IDEMPOTENCY_CONFLICT');
 const overrun=usage.inputTokens>r.cost.inputTokens||usage.outputTokens>r.cost.outputTokens,state=overrun?'overrun' as const:'settled' as const;
 for(const key of keys(r))await updateJson(store,key,(raw:unknown)=>{
  const c=counter(raw),entry=c.accounting?.[r.id];
  if(!entry)throw Error('MODEL_ATTEMPT_NOT_STARTED');
  if(entry.state==='settled'||entry.state==='overrun'){
   if(entry.inputTokens!==usage.inputTokens||entry.outputTokens!==usage.outputTokens)throw Error('IDEMPOTENCY_CONFLICT');
   return c;
  }
  const inputTokens=c.inputTokens+Math.max(0,usage.inputTokens-r.cost.inputTokens),outputTokens=c.outputTokens+Math.max(0,usage.outputTokens-r.cost.outputTokens);
  if(!Number.isSafeInteger(inputTokens)||!Number.isSafeInteger(outputTokens))throw Error('MODEL_ACCOUNTING_INVALID');
  return{...c,inputTokens,outputTokens,accounting:{...c.accounting,[r.id]:{state,startedAt:entry.startedAt,...usage}}};
 });
 await readGate(store);
 await updateJson(store,gateKey,(raw:unknown)=>{
  const g=gate(raw);if(!ownGate(g,r))return g;
  return{...g,active:overrun?{...g.active!,state:'overrun' as const}:null};
 });
 return{state,usage};
}
export function modelLimits(env:Record<string,string|undefined>=process.env):ModelLimits{return{projectCalls:Number(env.VIDEO_PROJECT_MAX_MODEL_CALLS),projectInputTokens:Number(env.VIDEO_PROJECT_MAX_INPUT_TOKENS),projectOutputTokens:Number(env.VIDEO_PROJECT_MAX_OUTPUT_TOKENS),dailyCalls:Number(env.VIDEO_DAILY_MAX_MODEL_CALLS)}}
