import {it,expect,vi} from 'vitest';
import {mkdtemp,rm,mkdir,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {FileStore} from '@/services/video/storage/file-store';
import {canonicalHash} from '@/services/video/domain/hash';
import {reserveModelBudget,startModelAttempt,settleModelUsage,markModelUsageUnknown} from '@/services/video/budget/model-budget';
const limits={projectCalls:10,projectInputTokens:10000,projectOutputTokens:10000,dailyCalls:20};
it('refuses first-time gate initialization when another project and old day have unaudited legacy usage',async()=>{
 const root=await mkdtemp(join(tmpdir(),'vb-model-upgrade-'));
 try{
  const store=new FileStore(root),id=canonicalHash({projectId:'legacy',stage:'one'}),hash=canonicalHash({inputTokens:100,outputTokens:50});
  const old={calls:1,inputTokens:100,outputTokens:50,reservations:{[id]:hash}};
  await store.create('projects/legacy/budget',old);await store.create('budgets/daily/2026-10-02',old);
  await store.create('projects/legacy/budget-intents/'+id,{hash,day:'2026-10-02'});
  await expect(reserveModelBudget(new FileStore(root),'new-project','new-day',{inputTokens:100,outputTokens:50},limits)).rejects.toThrow('MODEL_ACCOUNTING_MIGRATION_REQUIRED');
  await expect(store.readFresh('budgets/model-gate')).rejects.toThrow('STORE_NOT_FOUND');
 }finally{await rm(root,{recursive:true,force:true})}
});
it('does not initialize safe capacity from an unverifiable or symlinked inventory',async()=>{
 const root=await mkdtemp(join(tmpdir(),'vb-model-inventory-')),outside=await mkdtemp(join(tmpdir(),'vb-model-external-'));
 try{
  const store=new FileStore(root),blind={readFresh:store.readFresh.bind(store),create:store.create.bind(store),cas:store.cas.bind(store)};
  await expect(reserveModelBudget(blind,'project','one',{inputTokens:100,outputTokens:50},limits)).rejects.toThrow('MODEL_ACCOUNTING_MIGRATION_REQUIRED');
  await mkdir(join(root,'projects'),{recursive:true});await symlink(outside,join(root,'projects','hidden'));
  await expect(reserveModelBudget(store,'project','one',{inputTokens:100,outputTokens:50},limits)).rejects.toThrow('STORE_INVENTORY_INVALID');
  await expect(store.readFresh('budgets/model-gate')).rejects.toThrow('STORE_NOT_FOUND');
 }finally{await rm(root,{recursive:true,force:true});await rm(outside,{recursive:true,force:true})}
});
it('accounts actual usage exactly once while retaining conservative reservations and freezes an ignored output cap',async()=>{
 const root=await mkdtemp(join(tmpdir(),'vb-model-usage-'));
 try{
  const store=new FileStore(root),reserved=await reserveModelBudget(store,'project','one',{inputTokens:100,outputTokens:50},limits);
  await startModelAttempt(store,reserved.reservation);
  await Promise.all([settleModelUsage(store,reserved.reservation,{inputTokens:90,outputTokens:70}),settleModelUsage(store,reserved.reservation,{inputTokens:90,outputTokens:70})]);
  const counter=(await store.readFresh<{calls:number;inputTokens:number;outputTokens:number;accounting:Record<string,{state:string;inputTokens:number;outputTokens:number}>}>('projects/project/budget')).value;
  expect(counter.calls).toBe(1);expect(counter.inputTokens).toBe(100);expect(counter.outputTokens).toBe(70);
  expect(counter.accounting[reserved.reservation.id]).toMatchObject({state:'overrun',inputTokens:90,outputTokens:70});
  await expect(reserveModelBudget(new FileStore(root),'project','two',{inputTokens:1,outputTokens:1},limits)).rejects.toThrow('MODEL_BUDGET_OVERRUN');
  await expect(reserveModelBudget(new FileStore(root),'other','two',{inputTokens:1,outputTokens:1},limits)).rejects.toThrow('MODEL_BUDGET_OVERRUN');
  await expect(settleModelUsage(store,reserved.reservation,{inputTokens:91,outputTokens:70})).rejects.toThrow('IDEMPOTENCY_CONFLICT');
 }finally{await rm(root,{recursive:true,force:true})}
});
it('keeps unknown/pending paid attempts occupied across cold processes, without automatic reattempt or refund',async()=>{
 const root=await mkdtemp(join(tmpdir(),'vb-model-unknown-'));
 try{
  const store=new FileStore(root),reserved=await reserveModelBudget(store,'project','one',{inputTokens:100,outputTokens:50},limits);
  await startModelAttempt(store,reserved.reservation);
  await expect(reserveModelBudget(new FileStore(root),'project','two',{inputTokens:1,outputTokens:1},limits)).rejects.toThrow('MODEL_USAGE_UNCERTAIN');
  await markModelUsageUnknown(store,reserved.reservation);
  await expect(startModelAttempt(new FileStore(root),reserved.reservation)).rejects.toThrow('MODEL_ATTEMPT_ALREADY_STARTED');
  await expect(reserveModelBudget(new FileStore(root),'other','two',{inputTokens:1,outputTokens:1},limits)).rejects.toThrow('MODEL_USAGE_UNCERTAIN');
  const counter=(await store.readFresh<{inputTokens:number;outputTokens:number}>('projects/project/budget')).value;
  expect([counter.inputTokens,counter.outputTokens]).toEqual([100,50]);
 }finally{await rm(root,{recursive:true,force:true})}
});
it('permits a later bounded call after valid usage but never substitutes another reservation or malformed usage',async()=>{
 const root=await mkdtemp(join(tmpdir(),'vb-model-known-'));
 try{
  const store=new FileStore(root),first=await reserveModelBudget(store,'project','one',{inputTokens:100,outputTokens:50},limits);
  await startModelAttempt(store,first.reservation);await settleModelUsage(store,first.reservation,{inputTokens:80,outputTokens:40});
  const second=await reserveModelBudget(store,'project','two',{inputTokens:100,outputTokens:50},limits);
  await expect(startModelAttempt(store,{...second.reservation,id:first.reservation.id})).rejects.toThrow('MODEL_RESERVATION_INVALID');
  await startModelAttempt(store,second.reservation);
  await expect(settleModelUsage(store,second.reservation,{inputTokens:NaN,outputTokens:40})).rejects.toThrow('MODEL_USAGE_INVALID');
  await expect(reserveModelBudget(store,'project','three',{inputTokens:1,outputTokens:1},limits)).rejects.toThrow('MODEL_USAGE_UNCERTAIN');
 }finally{await rm(root,{recursive:true,force:true})}
});
it('repairs a partially written settlement in a cold process without double charging',async()=>{
 const root=await mkdtemp(join(tmpdir(),'vb-model-settlement-crash-'));
 try{
  const store=new FileStore(root),r=(await reserveModelBudget(store,'project','one',{inputTokens:100,outputTokens:50},limits)).reservation;
  await startModelAttempt(store,r);
  let fault=true;
  const broken={readFresh:store.readFresh.bind(store),create:store.create.bind(store),cas:async<T>(key:string,etag:string,value:T)=>{if(fault&&key==='projects/project/budget'){fault=false;throw Error('POWER_LOSS')}return store.cas(key,etag,value)}};
  await expect(settleModelUsage(broken,r,{inputTokens:120,outputTokens:60})).rejects.toThrow('POWER_LOSS');
  await settleModelUsage(new FileStore(root),r,{inputTokens:120,outputTokens:60});
  for(const key of ['projects/project/budget','budgets/daily/'+r.day]){
   const c=(await store.readFresh<{calls:number;inputTokens:number;outputTokens:number}>(key)).value;
   expect([c.calls,c.inputTokens,c.outputTokens]).toEqual([1,120,60]);
  }
 }finally{await rm(root,{recursive:true,force:true})}
});
it('does not treat historical reservations without usage accounting as safe new capacity',async()=>{
 const root=await mkdtemp(join(tmpdir(),'vb-model-legacy-'));
 try{
  const store=new FileStore(root),r=(await reserveModelBudget(store,'project','one',{inputTokens:100,outputTokens:50},limits)).reservation;
  const old=(await store.readFresh<Record<string,unknown>>('projects/project/budget')).value;
  delete old.accountingVersion;delete old.accounting;
  const snapshot=await store.readFresh('projects/project/budget');await store.cas('projects/project/budget',snapshot.etag,old);
  await expect(reserveModelBudget(new FileStore(root),'project','new-stage',{inputTokens:1,outputTokens:1},limits)).rejects.toThrow('MODEL_USAGE_UNCERTAIN');
  await expect(startModelAttempt(new FileStore(root),r)).rejects.toThrow('MODEL_USAGE_UNCERTAIN');
 }finally{await rm(root,{recursive:true,force:true})}
});
it.each(['unknown','overrun'] as const)('retains the deployment-wide %s latch across UTC midnight and other projects',async state=>{
 const root=await mkdtemp(join(tmpdir(),'vb-model-midnight-'));
 try{
  vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date('2026-10-03T23:59:50Z'));
  const store=new FileStore(root),r=(await reserveModelBudget(store,'project','one',{inputTokens:100,outputTokens:50},limits)).reservation;
  await startModelAttempt(store,r);
  if(state==='unknown')await markModelUsageUnknown(store,r);else await settleModelUsage(store,r,{inputTokens:100,outputTokens:70});
  vi.setSystemTime(new Date('2026-10-04T00:00:10Z'));
  await expect(reserveModelBudget(new FileStore(root),'other','new-day',{inputTokens:1,outputTokens:1},limits)).rejects.toThrow(state==='unknown'?'MODEL_USAGE_UNCERTAIN':'MODEL_BUDGET_OVERRUN');
 }finally{vi.useRealTimers();await rm(root,{recursive:true,force:true})}
});
it('rejects unused reservations from a past day before a paid attempt, without moving or refunding old capacity',async()=>{
 const root=await mkdtemp(join(tmpdir(),'vb-model-expired-reservation-'));
 try{
  vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date('2026-10-03T23:59:50Z'));
  const store=new FileStore(root),r=(await reserveModelBudget(store,'project','one',{inputTokens:100,outputTokens:50},{...limits,dailyCalls:1})).reservation;
  vi.setSystemTime(new Date('2026-10-04T00:00:10Z'));
  await expect(startModelAttempt(new FileStore(root),r)).rejects.toThrow('MODEL_RESERVATION_EXPIRED');
  const next=(await reserveModelBudget(store,'other','new-day',{inputTokens:100,outputTokens:50},{...limits,dailyCalls:1})).reservation;
  await startModelAttempt(store,next);
  await expect(reserveModelBudget(store,'third','same-day',{inputTokens:1,outputTokens:1},{...limits,dailyCalls:1})).rejects.toThrow('MODEL_USAGE_UNCERTAIN');
  expect((await store.readFresh<{calls:number}>('budgets/daily/'+r.day)).value.calls).toBe(1);
 }finally{vi.useRealTimers();await rm(root,{recursive:true,force:true})}
});
it('retains a global occupancy marker when the process fails before either attempt counter is written',async()=>{
 const root=await mkdtemp(join(tmpdir(),'vb-model-start-crash-'));
 try{
  const store=new FileStore(root),r=(await reserveModelBudget(store,'project','one',{inputTokens:100,outputTokens:50},limits)).reservation;
  const broken={readFresh:store.readFresh.bind(store),create:store.create.bind(store),cas:async<T>(key:string,etag:string,value:T)=>{if(key==='budgets/daily/'+r.day)throw Error('POWER_LOSS');return store.cas(key,etag,value)}};
  await expect(startModelAttempt(broken,r)).rejects.toThrow('POWER_LOSS');
  await expect(reserveModelBudget(new FileStore(root),'other','next',{inputTokens:1,outputTokens:1},limits)).rejects.toThrow('MODEL_USAGE_UNCERTAIN');
  await expect(startModelAttempt(new FileStore(root),r)).rejects.toThrow('MODEL_ATTEMPT_ALREADY_STARTED');
 }finally{await rm(root,{recursive:true,force:true})}
});
it('replays a completed prior-day receipt without clearing a different active attempt',async()=>{
 const root=await mkdtemp(join(tmpdir(),'vb-model-replay-gate-'));
 try{
  vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date('2026-10-03T23:59:50Z'));
  const store=new FileStore(root),r=(await reserveModelBudget(store,'project','one',{inputTokens:100,outputTokens:50},limits)).reservation;
  await startModelAttempt(store,r);await settleModelUsage(store,r,{inputTokens:90,outputTokens:40});
  vi.setSystemTime(new Date('2026-10-04T00:00:10Z'));
  const next=(await reserveModelBudget(store,'other','next',{inputTokens:100,outputTokens:50},limits)).reservation;await startModelAttempt(store,next);
  expect((await reserveModelBudget(new FileStore(root),'project','one',{inputTokens:100,outputTokens:50},limits)).reservation).toEqual(r);
  await settleModelUsage(new FileStore(root),r,{inputTokens:90,outputTokens:40});
  await markModelUsageUnknown(new FileStore(root),r);
  await expect(reserveModelBudget(new FileStore(root),'third','next',{inputTokens:1,outputTokens:1},limits)).rejects.toThrow('MODEL_USAGE_UNCERTAIN');
  await settleModelUsage(store,next,{inputTokens:90,outputTokens:40});
  await expect(reserveModelBudget(store,'third','next',{inputTokens:1,outputTokens:1},limits)).resolves.toBeDefined();
 }finally{vi.useRealTimers();await rm(root,{recursive:true,force:true})}
});
