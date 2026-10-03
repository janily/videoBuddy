import {z} from 'zod';
import {StoreMissing,createOrRead,updateJson,type AtomicStore} from '@/services/video/storage/atomic-store';
import {canonicalHash} from '@/services/video/domain/hash';
import {auditLegacyCounter,type LegacyAuditRow} from './legacy-audit';
const authKey='budgets/model-validation-authorization',planKey='budgets/model-validation-migration',receiptKey=planKey+'-receipt',gateKey='budgets/model-gate';
const digest=z.string().regex(/^[a-f0-9]{64}$/);
const authorizationSchema=z.strictObject({schemaVersion:z.literal(1),authorizationId:z.uuid(),authorizedAt:z.string().datetime(),source:z.literal('user_instruction'),sourceSha256:digest,mode:z.literal('unlimited_validation')});
export type ValidationAuthorization=z.infer<typeof authorizationSchema>;
export async function requireUnlimitedValidation(store:AtomicStore){
 try{const parsed=authorizationSchema.safeParse((await store.readFresh(authKey)).value);if(!parsed.success)throw Error('MODEL_VALIDATION_AUTHORIZATION_REQUIRED');return parsed.data}catch(error){if(error instanceof StoreMissing)throw Error('MODEL_VALIDATION_AUTHORIZATION_REQUIRED');throw error}
}
async function inventory(store:AtomicStore){
 if(!store.listKeys)throw Error('MODEL_MIGRATION_INVENTORY_CHANGED');
 const [daily,projects]=await Promise.all([store.listKeys('budgets/daily',1),store.listKeys('projects',2)]);
 const keys=[...daily,...projects.filter(key=>/^projects\/[A-Za-z0-9_-]+\/budget$/.test(key))].sort();
 return Promise.all(keys.map(async key=>({key,value:(await store.readFresh<Record<string,unknown>>(key)).value})));
}
/** Explicit local operator authorization, never a browser request or model tool. */
export async function authorizeUnlimitedValidation(store:AtomicStore,untrusted:unknown){
 const auth=authorizationSchema.parse(untrusted),items=await inventory(store);
 if(items.some(item=>item.value.calls!==0&&item.value.accountingVersion!==2))throw Error('MODEL_ACCOUNTING_MIGRATION_REQUIRED');
 try{const gate=(await store.readFresh<{active:null|{state:string}}>(gateKey)).value;if(gate.active&&gate.active.state!=='overrun')throw Error('MODEL_USAGE_UNCERTAIN')}catch(error){if(!(error instanceof StoreMissing))throw error;if(items.some(item=>item.value.calls!==0))throw Error('MODEL_ACCOUNTING_MIGRATION_REQUIRED')}
 const saved=await createOrRead(store,authKey,auth);if(canonicalHash(saved)!==canonicalHash(auth))throw Error('IDEMPOTENCY_CONFLICT');return auth;
}
interface LegacyProject{projectId:string;counter:unknown;rows:LegacyAuditRow[]}
interface MigrationPlan{schemaVersion:1;requestHash:string;authorization:ValidationAuthorization;counters:{key:string;original:unknown;candidate:unknown}[];audits:ReturnType<typeof auditLegacyCounter>[]}
interface Gate{schemaVersion:1;active:null|{id:string;projectId:string;day:string;hash:string;state:string;startedAt:string}}
/** Stopped-worker migration: preserve snapshots, reservations and evidence gaps.
 * Historical entries prevent replay of old effects; their reported usage is not
 * promoted to a provider-verified settlement. Unknown current attempts remain blocked.
 */
export async function migrateLegacyValidation(store:AtomicStore,projects:LegacyProject[],untrustedAuthorization:unknown){
 const auth=authorizationSchema.parse(untrustedAuthorization),requestHash=canonicalHash({projects,authorization:auth});
 if(projects.length>64||new Set(projects.map(project=>project.projectId)).size!==projects.length)throw Error('MODEL_MIGRATION_INVENTORY_CHANGED');
 let plan:MigrationPlan|undefined;
 try{plan=(await store.readFresh<MigrationPlan>(planKey)).value;if(plan.requestHash!==requestHash)throw Error('IDEMPOTENCY_CONFLICT')}catch(error){if(!(error instanceof StoreMissing))throw error}
 const audits=projects.map(project=>auditLegacyCounter(project.projectId,project.counter,project.rows)),records=audits.flatMap(audit=>audit.rows),counters:MigrationPlan['counters']=[];
 const entry=(row:LegacyAuditRow)=>({state:'historical',recordedAt:auth.authorizedAt,evidence:row.evidence,...(row.responseSha256?{responseSha256:row.responseSha256}:{}),...row.usage});
 function addCounter(key:string,rows:LegacyAuditRow[]){
   const reservations=Object.fromEntries(rows.map(row=>[row.id,canonicalHash(row.cost)])),original={calls:rows.length,inputTokens:rows.reduce((n,row)=>n+row.cost.inputTokens,0),outputTokens:rows.reduce((n,row)=>n+row.cost.outputTokens,0),reservations};
   if(!rows.length||rows.length!==new Set(rows.map(row=>row.id)).size)throw Error('MODEL_MIGRATION_INVENTORY_CHANGED');
   const candidate={...original,inputTokens:original.inputTokens+rows.reduce((n,row)=>n+Math.max(0,row.usage.inputTokens-row.cost.inputTokens),0),outputTokens:original.outputTokens+rows.reduce((n,row)=>n+Math.max(0,row.usage.outputTokens-row.cost.outputTokens),0),accountingVersion:2,accounting:Object.fromEntries(rows.map(row=>[row.id,entry(row)]))};
   if(![original.inputTokens,original.outputTokens,candidate.inputTokens,candidate.outputTokens].every(Number.isSafeInteger))throw Error('MODEL_ACCOUNTING_INVALID');
   counters.push({key,original,candidate});
 }
 for(let index=0;index<projects.length;index++){
  addCounter('projects/'+projects[index].projectId+'/budget',audits[index].rows);
  for(const row of audits[index].rows){const intent=(await store.readFresh<{day:string;hash:string}>('projects/'+projects[index].projectId+'/budget-intents/'+row.id)).value;if(intent.day!==row.day||intent.hash!==canonicalHash(row.cost))throw Error('MODEL_MIGRATION_INVENTORY_CHANGED')}
 }
 for(const day of new Set(records.map(row=>row.day)))addCounter('budgets/daily/'+day,records.filter(row=>row.day===day));
 counters.sort((a,b)=>a.key.localeCompare(b.key));
 const expectedPlan:MigrationPlan={schemaVersion:1,requestHash,authorization:auth,counters,audits};
 if(plan&&canonicalHash(plan)!==canonicalHash(expectedPlan))throw Error('MODEL_MIGRATION_PLAN_CHANGED');
 if(!plan){
  const occupied=(await inventory(store)).filter(item=>item.value.calls!==0);
  if(canonicalHash(occupied.map(item=>item.key).sort())!==canonicalHash(counters.map(item=>item.key).sort()))throw Error('MODEL_MIGRATION_INVENTORY_CHANGED');
  for(const item of occupied)if(canonicalHash(item.value)!==canonicalHash(counters.find(counter=>counter.key===item.key)!.original))throw Error('MODEL_MIGRATION_INVENTORY_CHANGED');
  plan=await createOrRead(store,planKey,expectedPlan);if(canonicalHash(plan)!==canonicalHash(expectedPlan))throw Error('MODEL_MIGRATION_PLAN_CHANGED');
 }
 const receipt={schemaVersion:1,requestHash,planHash:canonicalHash(plan),additionalModelCalls:0,originalCountersRetained:true,historicalEvidenceRetained:true};
 async function release(){await updateJson(store,gateKey,(gate:Gate)=>gate.active?.id===requestHash&&gate.active.projectId==='legacy-migration'?{schemaVersion:1 as const,active:null}:gate)}
 try{const completed=(await store.readFresh(receiptKey)).value;if(canonicalHash(completed)!==canonicalHash(receipt))throw Error('IDEMPOTENCY_CONFLICT');await release();return receipt}catch(error){if(!(error instanceof StoreMissing))throw error}
 const marker={id:requestHash,projectId:'legacy-migration',day:auth.authorizedAt.slice(0,10),hash:canonicalHash(plan),state:'unknown',startedAt:auth.authorizedAt};
 await createOrRead(store,gateKey,{schemaVersion:1,active:marker});
 await updateJson(store,gateKey,(gate:Gate)=>{if(gate.active&&(gate.active.id!==requestHash||gate.active.projectId!=='legacy-migration'||gate.active.hash!==marker.hash))throw Error('MODEL_USAGE_UNCERTAIN');return{schemaVersion:1 as const,active:marker}});
 async function checkInventory(){const occupied=(await inventory(store)).filter(item=>item.value.calls!==0);if(canonicalHash(occupied.map(item=>item.key).sort())!==canonicalHash(plan!.counters.map(item=>item.key).sort()))throw Error('MODEL_MIGRATION_INVENTORY_CHANGED');for(const item of occupied){const expected=plan!.counters.find(counter=>counter.key===item.key)!;if(![canonicalHash(expected.original),canonicalHash(expected.candidate)].includes(canonicalHash(item.value)))throw Error('MODEL_MIGRATION_INVENTORY_CHANGED')}}
 await checkInventory();
 for(const item of plan.counters)await updateJson(store,item.key,(current:unknown)=>{const hash=canonicalHash(current);if(hash===canonicalHash(item.candidate))return current;if(hash!==canonicalHash(item.original))throw Error('MODEL_MIGRATION_INVENTORY_CHANGED');return item.candidate});
 await checkInventory();
 const savedAuth=await createOrRead(store,authKey,auth);if(canonicalHash(savedAuth)!==canonicalHash(auth))throw Error('IDEMPOTENCY_CONFLICT');
 const savedReceipt=await createOrRead(store,receiptKey,receipt);if(canonicalHash(savedReceipt)!==canonicalHash(receipt))throw Error('IDEMPOTENCY_CONFLICT');
 await release();return receipt;
}
