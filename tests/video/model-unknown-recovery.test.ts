import {expect,it} from 'vitest';
import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {FileStore} from '@/services/video/storage/file-store';
import {authorizeUnlimitedValidation} from '@/services/video/budget/validation-authorization';
import {authorizeUnknownModelRecovery} from '@/services/video/budget/unknown-recovery';
import {reserveModelBudget,startModelAttempt,markModelUsageUnknown,settleModelUsage} from '@/services/video/budget/model-budget';
const limits={projectCalls:10,projectInputTokens:10000,projectOutputTokens:10000,dailyCalls:20,mode:'unlimited_validation' as const};
async function fixture(){const root=await mkdtemp(join(tmpdir(),'vb-unknown-recovery-')),store=new FileStore(root);await authorizeUnlimitedValidation(store,{schemaVersion:1,authorizationId:randomUUID(),authorizedAt:new Date().toISOString(),source:'user_instruction',sourceSha256:'a'.repeat(64),mode:'unlimited_validation'});const old=(await reserveModelBudget(store,'old','one',{inputTokens:100,outputTokens:50},limits)).reservation;await startModelAttempt(store,old);await markModelUsageUnknown(store,old);return{store,root,old}}
const auth=()=>({schemaVersion:1 as const,authorizationId:randomUUID(),authorizedAt:new Date().toISOString(),source:'user_instruction' as const,sourceSha256:'b'.repeat(64),maxDeferredUnknown:1});
it('explicit bounded recovery permits a different call while preserving unknown cost and preventing the old attempt replay',async()=>{
 const {store,root,old}=await fixture();await expect(reserveModelBudget(store,'new','one',{inputTokens:100,outputTokens:50},limits)).rejects.toThrow('MODEL_USAGE_UNCERTAIN');await authorizeUnknownModelRecovery(store,auth());
 const next=(await reserveModelBudget(new FileStore(root),'new','one',{inputTokens:100,outputTokens:50},limits)).reservation;await startModelAttempt(store,next);
 await expect(startModelAttempt(store,old)).rejects.toThrow('MODEL_ATTEMPT_ALREADY_STARTED');await expect(reserveModelBudget(store,'third','one',{inputTokens:1,outputTokens:1},limits)).rejects.toThrow('MODEL_USAGE_UNCERTAIN');await settleModelUsage(store,next,{inputTokens:40,outputTokens:30});
 const counter=(await store.readFresh<{inputTokens:number;outputTokens:number;accounting:Record<string,{state:string}>}>('projects/old/budget')).value;expect(counter).toMatchObject({inputTokens:100,outputTokens:50});expect(counter.accounting[old.id].state).toBe('unknown');const gate=(await store.readFresh('budgets/model-gate')).value;expect(gate).toMatchObject({active:null,deferredUnknown:[{id:old.id,state:'unknown'}]});
});
it('enforces the authorized unknown-slot bound across cold processes, never treating pending requests as stopped',async()=>{
 const {store,root}=await fixture();await authorizeUnknownModelRecovery(store,auth());const next=(await reserveModelBudget(store,'new','one',{inputTokens:100,outputTokens:50},limits)).reservation;await startModelAttempt(store,next);await markModelUsageUnknown(store,next);await expect(reserveModelBudget(new FileStore(root),'third','one',{inputTokens:1,outputTokens:1},limits)).rejects.toThrow('MODEL_UNKNOWN_RECOVERY_LIMIT');
});
it('frees a deferred slot only after actual late usage settlement while retaining immutable unknown history',async()=>{
 const {store,root,old}=await fixture();await authorizeUnknownModelRecovery(store,auth());const b=(await reserveModelBudget(store,'new','one',{inputTokens:100,outputTokens:50},limits)).reservation;await startModelAttempt(store,b);await settleModelUsage(store,b,{inputTokens:40,outputTokens:30});
 await settleModelUsage(store,old,{inputTokens:80,outputTokens:40});const c=(await reserveModelBudget(store,'new','two',{inputTokens:100,outputTokens:50},limits)).reservation;await startModelAttempt(store,c);await markModelUsageUnknown(store,c);
 const d=await reserveModelBudget(new FileStore(root),'other','one',{inputTokens:100,outputTokens:50},limits);expect(d.reservation.projectId).toBe('other');
 expect((await store.readFresh(`budgets/model-unknown-recovery-history/${old.id}`)).value).toMatchObject({id:old.id,state:'unknown'});
});
it('extends the operator bound with an immutable old authorization, preserving costs and blocking replay',async()=>{
 const {store,root,old}=await fixture(),original=auth();await authorizeUnknownModelRecovery(store,original);
 const {extendUnknownModelRecovery,unknownModelRecoveryLimit}=await import('@/services/video/budget/unknown-recovery'),{canonicalHash}=await import('@/services/video/domain/hash');
 const next=(await reserveModelBudget(store,'new','one',{inputTokens:100,outputTokens:50},limits)).reservation;await startModelAttempt(store,next);await markModelUsageUnknown(store,next);
 await expect(reserveModelBudget(store,'third','one',{inputTokens:100,outputTokens:50},limits)).rejects.toThrow('MODEL_UNKNOWN_RECOVERY_LIMIT');
 await expect(extendUnknownModelRecovery(store,{...original,schemaVersion:2,maxDeferredUnknown:9})).rejects.toThrow();
 const gate=(await store.readFresh('budgets/model-gate')).value;
 await extendUnknownModelRecovery(store,{...original,schemaVersion:2,authorizationId:randomUUID(),maxDeferredUnknown:8});
 expect(await unknownModelRecoveryLimit(new FileStore(root))).toBe(8);
 expect((await store.readFresh('budgets/model-gate')).value).toEqual(gate);
 expect((await store.readFresh('budgets/model-unknown-recovery-authorization-history/'+canonicalHash(original))).value).toEqual(original);
 const third=(await reserveModelBudget(store,'third','one',{inputTokens:100,outputTokens:50},limits)).reservation;await startModelAttempt(store,third);
 await expect(startModelAttempt(store,old)).rejects.toThrow('MODEL_ATTEMPT_ALREADY_STARTED');
 expect((await store.readFresh<{inputTokens:number}>('projects/old/budget')).value.inputTokens).toBe(100);
});
