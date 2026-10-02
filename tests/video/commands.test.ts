import { it,expect,beforeEach,afterEach } from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {FileStore} from './helpers/file-store';
import {CommandService} from '@/services/video/commands/submit';
import {claimOperation} from '@/services/video/commands/claim';
import {runEffect} from '@/services/video/commands/effect-ledger';
let dir:string;
beforeEach(async()=>dir=await mkdtemp(`${tmpdir()}/vb-command-`));
afterEach(async()=>{await rm(dir,{recursive:true,force:true})});
it('AT-010 concurrent duplicate commands archive one receipt and reserve one operation',async()=>{
 const store=new FileStore(dir);await store.create('projects/p/control',{controlVersion:0,receipts:[],activeConversation:null});
 const service=new CommandService(store,async()=>({runId:'run-one'}));
 const input={clientCommandId:'command-one',clientMessageId:'message-one',text:'你好'};
 const receipts=await Promise.all([service.submit('p','chat',input),service.submit('p','chat',input)]);
 expect(receipts[0].operationId).toBe(receipts[1].operationId);
 const control=await store.readFresh<{receipts:unknown[]}>('projects/p/control');expect(control.value.receipts).toHaveLength(1);
});
it('AT-011 same command ID with different body conflicts',async()=>{
 const store=new FileStore(dir);await store.create('projects/p/control',{controlVersion:0,receipts:[],activeConversation:null});
 const service=new CommandService(store,async()=>({runId:'r'}));await service.submit('p','chat',{clientCommandId:'c',text:'a'});
 await expect(service.submit('p','chat',{clientCommandId:'c',text:'b'})).rejects.toThrow('IDEMPOTENCY_CONFLICT');
});
it('AT-012 only canonical run can execute, and the same run can resume',async()=>{
 const store=new FileStore(dir);await store.create('operations/op',{canonicalRunId:null,status:'reserved',fence:0});
 const claims=await Promise.all([claimOperation(store,'operations/op','run-a'),claimOperation(store,'operations/op','run-b')]);
 expect(claims.filter(c=>c.claimed)).toHaveLength(1);
 const winner=claims.find(c=>c.claimed)!;expect((await claimOperation(store,'operations/op',winner.canonicalRunId)).claimed).toBe(true);
});
it('stage results are reused, and uncertain billing effects are not repeated',async()=>{
 const store=new FileStore(dir);let effects=0;
 const operation=async()=>({text:'result',count:++effects});
 expect(await runEffect(store,'effects/stage',operation)).toEqual({text:'result',count:1});
 expect(await runEffect(store,'effects/stage',operation)).toEqual({text:'result',count:1});expect(effects).toBe(1);
 await store.create('effects/unknown',{status:'started',attemptId:'old'});
 await expect(runEffect(store,'effects/unknown',operation)).rejects.toThrow('EFFECT_UNKNOWN');expect(effects).toBe(1);
});
it('START_FAILED retains the receipt and recover reuses the reserved operation',async()=>{
 const store=new FileStore(dir);await store.create('projects/p/control',{controlVersion:0,receipts:[],activeConversation:null});
 let working=false;const service=new CommandService(store,async()=>{if(!working)throw Error('network');return{runId:'r'}});
 const input={clientCommandId:'c',text:'a'};
 await expect(service.submit('p','chat',input)).rejects.toMatchObject({code:'START_FAILED',receipt:{status:'reserved'}});
 const reserved=await store.readFresh<{receipts:{operationId:string}[]}>('projects/p/control');working=true;
 const recovered=await service.submit('p','chat',input);expect(recovered.operationId).toBe(reserved.value.receipts[0].operationId);
});
