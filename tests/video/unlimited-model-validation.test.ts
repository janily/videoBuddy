import {it,expect} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {FileStore} from '@/services/video/storage/file-store';
import {canonicalHash} from '@/services/video/domain/hash';
import {authorizeUnlimitedValidation,migrateLegacyValidation} from '@/services/video/budget/validation-authorization';
import {reserveModelBudget,startModelAttempt,settleModelUsage,markModelUsageUnknown,modelLimits} from '@/services/video/budget/model-budget';
import {withAccountedModel,markModelCallStarted,recordModelUsage} from '@/services/video/budget/model-call';
const authorization=()=>({schemaVersion:1 as const,authorizationId:randomUUID(),authorizedAt:new Date().toISOString(),source:'user_instruction' as const,sourceSha256:'a'.repeat(64),mode:'unlimited_validation' as const});
const limits={projectCalls:1,projectInputTokens:1,projectOutputTokens:1,dailyCalls:1,mode:'unlimited_validation' as const};
it('requires durable authorization; unlimited accepts accounted output overruns without refund or losing usage',async()=>{
 const root=await mkdtemp(join(tmpdir(),'vb-unlimited-'));
 try{
  const store=new FileStore(root);
  await expect(reserveModelBudget(store,'project','one',{inputTokens:100,outputTokens:50},limits)).rejects.toThrow('MODEL_VALIDATION_AUTHORIZATION_REQUIRED');
  await authorizeUnlimitedValidation(store,authorization());
  const r=(await reserveModelBudget(store,'project','one',{inputTokens:100,outputTokens:50},limits)).reservation;
  await expect(withAccountedModel(store,r,async()=>{await markModelCallStarted();await recordModelUsage({inputTokens:80,outputTokens:70});return 'actual-output'})).resolves.toBe('actual-output');
  const cold=new FileStore(root),next=(await reserveModelBudget(cold,'project','two',{inputTokens:100,outputTokens:50},limits)).reservation;
  await startModelAttempt(cold,next);await settleModelUsage(cold,next,{inputTokens:80,outputTokens:40});
  expect((await cold.readFresh('projects/project/budget')).value).toMatchObject({calls:2,inputTokens:200,outputTokens:120,accounting:{[r.id]:{state:'overrun',inputTokens:80,outputTokens:70}}});
 }finally{await rm(root,{recursive:true,force:true})}
});
it('never relaxes unknown usage or automatically reattempts a paid request under unlimited authorization',async()=>{
 const root=await mkdtemp(join(tmpdir(),'vb-unlimited-unknown-'));
 try{
  const store=new FileStore(root);await authorizeUnlimitedValidation(store,authorization());
  const r=(await reserveModelBudget(store,'project','one',{inputTokens:100,outputTokens:50},limits)).reservation;
  await startModelAttempt(store,r);await markModelUsageUnknown(store,r);
  await expect(reserveModelBudget(new FileStore(root),'other','two',{inputTokens:1,outputTokens:1},limits)).rejects.toThrow('MODEL_USAGE_UNCERTAIN');
  await expect(startModelAttempt(store,r)).rejects.toThrow('MODEL_ATTEMPT_ALREADY_STARTED');
 }finally{await rm(root,{recursive:true,force:true})}
});
it('migrates exactly covered legacy counters with explicit historical provenance and conservative overrun totals',async()=>{
 const root=await mkdtemp(join(tmpdir(),'vb-unlimited-legacy-'));
 try{
  const store=new FileStore(root),projectId='legacy',stage='old',cost={inputTokens:20,outputTokens:10},id=canonicalHash({projectId,stage}),hash=canonicalHash(cost),day=new Date().toISOString().slice(0,10);
  const counter={calls:1,inputTokens:20,outputTokens:10,reservations:{[id]:hash}},rows=[{id,stage,cost,day,usage:{inputTokens:3,outputTokens:12},evidence:'historical_report' as const}];
  await store.create('projects/legacy/budget',counter);await store.create('budgets/daily/'+day,counter);await store.create('projects/legacy/budget-intents/'+id,{hash,day});
  const auth=authorization();
  await expect(migrateLegacyValidation(store,[{projectId,counter,rows:[]}],auth)).rejects.toThrow('LEGACY_AUDIT_INVALID');
  const migration=await migrateLegacyValidation(store,[{projectId,counter,rows}],auth);
  expect(migration.additionalModelCalls).toBe(0);
  for(const key of ['projects/legacy/budget','budgets/daily/'+day])expect((await store.readFresh(key)).value).toMatchObject({calls:1,inputTokens:20,outputTokens:12,accountingVersion:2,accounting:{[id]:{state:'historical',evidence:'historical_report',inputTokens:3,outputTokens:12}}});
  const next=(await reserveModelBudget(new FileStore(root),'legacy','new',{inputTokens:1,outputTokens:1},limits)).reservation;
  await startModelAttempt(store,next);
  expect(await migrateLegacyValidation(new FileStore(root),[{projectId,counter,rows}],auth)).toEqual(migration);
  expect((await store.readFresh('budgets/model-gate')).value).toMatchObject({active:{id:next.id,state:'started'}});
  await settleModelUsage(store,next,{inputTokens:1,outputTokens:1});
  await expect(startModelAttempt(store,{projectId,stage,id,hash,cost,day})).rejects.toThrow('MODEL_ATTEMPT_ALREADY_STARTED');
  expect(await migrateLegacyValidation(new FileStore(root),[{projectId,counter,rows}],auth)).toEqual(migration);
  expect((await store.readFresh('projects/legacy/budget')).value).toMatchObject({calls:2});
 }finally{await rm(root,{recursive:true,force:true})}
});
it('requires both actual settlements before acknowledging a prior bounded overrun',async()=>{
 const root=await mkdtemp(join(tmpdir(),'vb-unlimited-known-overrun-'));
 try{
  const store=new FileStore(root),bounded={projectCalls:10,projectInputTokens:1000,projectOutputTokens:1000,dailyCalls:10};
  const first=(await reserveModelBudget(store,'project','bounded',{inputTokens:100,outputTokens:50},bounded)).reservation;
  await startModelAttempt(store,first);await settleModelUsage(store,first,{inputTokens:80,outputTokens:70});
  await authorizeUnlimitedValidation(store,authorization());
  const snapshot=await store.readFresh<{accounting:Record<string,{state:string;startedAt:string}>}>('projects/project/budget');
  const original=structuredClone(snapshot.value);snapshot.value.accounting[first.id]={state:'started',startedAt:original.accounting[first.id].startedAt};await store.cas('projects/project/budget',snapshot.etag,snapshot.value);
  await expect(reserveModelBudget(store,'other','after-partial',{inputTokens:1,outputTokens:1},limits)).rejects.toThrow('MODEL_USAGE_UNCERTAIN');
  await store.cas('projects/project/budget',(await store.readFresh('projects/project/budget')).etag,original);
  const next=(await reserveModelBudget(new FileStore(root),'project','accepted',{inputTokens:1,outputTokens:1},limits)).reservation;
  await startModelAttempt(store,next);await settleModelUsage(store,next,{inputTokens:1,outputTokens:1});
  expect((await store.readFresh('projects/project/budget')).value).toMatchObject({calls:2,inputTokens:101,outputTokens:71,accounting:{[first.id]:{state:'overrun'}}});
 }finally{await rm(root,{recursive:true,force:true})}
});
it('fails closed for occupied legacy projects omitted from migration inventory',async()=>{
 const root=await mkdtemp(join(tmpdir(),'vb-unlimited-inventory-'));
 try{
  const store=new FileStore(root);await store.create('projects/hidden/budget',{calls:1,inputTokens:1,outputTokens:1,reservations:{['b'.repeat(64)]:'c'.repeat(64)}});
  await expect(migrateLegacyValidation(store,[],authorization())).rejects.toThrow('MODEL_MIGRATION_INVENTORY_CHANGED');
  await expect(authorizeUnlimitedValidation(store,authorization())).rejects.toThrow('MODEL_ACCOUNTING_MIGRATION_REQUIRED');
 }finally{await rm(root,{recursive:true,force:true})}
});
it.each(['missing','empty'])('rejects a %s historical daily counter instead of creating fresh daily capacity',async state=>{
 const root=await mkdtemp(join(tmpdir(),'vb-migration-missing-day-'));
 try{
  const store=new FileStore(root),projectId='legacy',stage='old',cost={inputTokens:20,outputTokens:10},id=canonicalHash({projectId,stage}),hash=canonicalHash(cost),day=new Date().toISOString().slice(0,10);
  const counter={calls:1,inputTokens:20,outputTokens:10,reservations:{[id]:hash}},rows=[{id,stage,cost,day,usage:{inputTokens:3,outputTokens:12},evidence:'historical_report' as const}];
  await store.create('projects/legacy/budget',counter);await store.create('projects/legacy/budget-intents/'+id,{hash,day});
  if(state==='empty')await store.create('budgets/daily/'+day,{calls:0,inputTokens:0,outputTokens:0,reservations:{},accountingVersion:2});
  await expect(migrateLegacyValidation(store,[{projectId,counter,rows}],authorization())).rejects.toThrow('MODEL_MIGRATION_INVENTORY_CHANGED');
  expect((await store.readFresh('projects/legacy/budget')).value).toEqual(counter);
  await expect(store.readFresh('budgets/model-gate')).rejects.toThrow('STORE_NOT_FOUND');
 }finally{await rm(root,{recursive:true,force:true})}
});
it('cold-resumes a partial migration under an occupied gate without resetting or double-adding an overrun',async()=>{
 const root=await mkdtemp(join(tmpdir(),'vb-migration-crash-'));
 try{
  const store=new FileStore(root),projectId='legacy',stage='old',cost={inputTokens:20,outputTokens:10},id=canonicalHash({projectId,stage}),hash=canonicalHash(cost),day=new Date().toISOString().slice(0,10),auth=authorization();
  const counter={calls:1,inputTokens:20,outputTokens:10,reservations:{[id]:hash}},rows=[{id,stage,cost,day,usage:{inputTokens:3,outputTokens:12},evidence:'historical_report' as const}],projects=[{projectId,counter,rows}];
  await store.create('projects/legacy/budget',counter);await store.create('budgets/daily/'+day,counter);await store.create('projects/legacy/budget-intents/'+id,{hash,day});
  let fault=true;const broken={readFresh:store.readFresh.bind(store),create:store.create.bind(store),listKeys:store.listKeys.bind(store),cas:async<T>(key:string,etag:string,value:T)=>{if(fault&&key==='projects/legacy/budget'){fault=false;throw Error('POWER_LOSS')}return store.cas(key,etag,value)}};
  await expect(migrateLegacyValidation(broken,projects,auth)).rejects.toThrow('POWER_LOSS');
  expect((await store.readFresh('budgets/model-gate')).value).toMatchObject({active:{state:'unknown',projectId:'legacy-migration'}});
  await expect(reserveModelBudget(store,'new','call',{inputTokens:1,outputTokens:1},limits)).rejects.toThrow('MODEL_VALIDATION_AUTHORIZATION_REQUIRED');
  await migrateLegacyValidation(new FileStore(root),projects,auth);
  for(const key of ['projects/legacy/budget','budgets/daily/'+day])expect((await store.readFresh(key)).value).toMatchObject({calls:1,inputTokens:20,outputTokens:12});
  expect((await store.readFresh('budgets/model-gate')).value).toEqual({schemaVersion:1,active:null});
 }finally{await rm(root,{recursive:true,force:true})}
});
it('rejects a corrupted saved migration candidate even when its request hash matches',async()=>{
 const root=await mkdtemp(join(tmpdir(),'vb-migration-plan-corruption-'));
 try{
  const store=new FileStore(root),projectId='legacy',stage='old',cost={inputTokens:20,outputTokens:10},id=canonicalHash({projectId,stage}),hash=canonicalHash(cost),day=new Date().toISOString().slice(0,10),auth=authorization();
  const counter={calls:1,inputTokens:20,outputTokens:10,reservations:{[id]:hash}},rows=[{id,stage,cost,day,usage:{inputTokens:3,outputTokens:12},evidence:'historical_report' as const}],projects=[{projectId,counter,rows}];
  await store.create('projects/legacy/budget',counter);await store.create('budgets/daily/'+day,counter);await store.create('projects/legacy/budget-intents/'+id,{hash,day});
  const broken={readFresh:store.readFresh.bind(store),cas:store.cas.bind(store),listKeys:store.listKeys.bind(store),create:async<T>(key:string,value:T)=>{await store.create(key,value);if(key==='budgets/model-validation-migration')throw Error('ACK_LOST')}};
  await expect(migrateLegacyValidation(broken,projects,auth)).rejects.toThrow('ACK_LOST');
  const saved=await store.readFresh<{counters:{candidate:{inputTokens:number;outputTokens:number}}[]}>('budgets/model-validation-migration');
  for(const item of saved.value.counters){item.candidate.inputTokens=0;item.candidate.outputTokens=0}await store.cas('budgets/model-validation-migration',saved.etag,saved.value);
  await expect(migrateLegacyValidation(new FileStore(root),projects,auth)).rejects.toThrow('MODEL_MIGRATION_PLAN_CHANGED');
  for(const key of ['projects/legacy/budget','budgets/daily/'+day])expect((await store.readFresh(key)).value).toEqual(counter);
 }finally{await rm(root,{recursive:true,force:true})}
});
it('unlimited config keeps finite integer accounting while ordinary configurations retain their limits',()=>{
 expect(modelLimits({VIDEO_MODEL_BUDGET_MODE:'unlimited_validation'})).toEqual({projectCalls:Number.MAX_SAFE_INTEGER,projectInputTokens:Number.MAX_SAFE_INTEGER,projectOutputTokens:Number.MAX_SAFE_INTEGER,dailyCalls:Number.MAX_SAFE_INTEGER,mode:'unlimited_validation'});
 expect(modelLimits({VIDEO_PROJECT_MAX_MODEL_CALLS:'2',VIDEO_PROJECT_MAX_INPUT_TOKENS:'3',VIDEO_PROJECT_MAX_OUTPUT_TOKENS:'4',VIDEO_DAILY_MAX_MODEL_CALLS:'5'})).toEqual({projectCalls:2,projectInputTokens:3,projectOutputTokens:4,dailyCalls:5});
});
