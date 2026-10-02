import{it,expect,beforeEach,afterEach}from'vitest';import{mkdtemp,rm}from'node:fs/promises';import{tmpdir}from'node:os';import{FileStore}from'./helpers/file-store';import{reserveModelBudget}from'@/services/video/budget/model-budget';
let dir:string;beforeEach(async()=>dir=await mkdtemp(`${tmpdir()}/vb-budget-`));afterEach(async()=>{await rm(dir,{recursive:true,force:true})});
const limits={projectCalls:2,projectInputTokens:200,projectOutputTokens:100,dailyCalls:2};
it('same stage reserves once and concurrent calls cannot overrun project or daily limits',async()=>{
 const store=new FileStore(dir);await Promise.all([reserveModelBudget(store,'p','one',{inputTokens:100,outputTokens:50},limits),reserveModelBudget(store,'p','one',{inputTokens:100,outputTokens:50},limits)]);
 await reserveModelBudget(store,'p','two',{inputTokens:100,outputTokens:50},limits);
 await expect(reserveModelBudget(store,'p','three',{inputTokens:1,outputTokens:1},limits)).rejects.toThrow('BUDGET_EXCEEDED');
 await expect(reserveModelBudget(store,'other','four',{inputTokens:1,outputTokens:1},limits)).rejects.toThrow('BUDGET_EXCEEDED');
});
it('a reused stage with changed bounds conflicts; invalid limits fail closed',async()=>{
 const store=new FileStore(dir);await reserveModelBudget(store,'p','one',{inputTokens:10,outputTokens:10},limits);
 await expect(reserveModelBudget(store,'p','one',{inputTokens:20,outputTokens:10},limits)).rejects.toThrow('IDEMPOTENCY_CONFLICT');
 await expect(reserveModelBudget(store,'p','two',{inputTokens:10,outputTokens:10},{...limits,dailyCalls:0})).rejects.toThrow('CONFIGURATION_REQUIRED');
});
