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
