import {it,expect,vi} from 'vitest';
import {createServer} from 'node:http';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {initialUnderstanding} from '@/contracts/video/domain';
import {runDirector} from '@/mastra/video/director';
import {FileStore} from '@/services/video/storage/file-store';
import {reserveModelBudget} from '@/services/video/budget/model-budget';
import {withAccountedModel} from '@/services/video/budget/model-call';

it.each(['known','overrun','missing','invalid_style'] as const)('records actual Mastra/provider usage before semantic validation (%s)',async mode=>{
 let calls=0;
 const content=JSON.stringify({action:'ask',reply:'你希望给谁看？',effect:'no_change',question:{topic:'audience',text:'你希望给谁看？',required:false,reason:'帮助选择讲述方式'},executionIntent:'none',evidenceMessageIds:[],...(mode==='invalid_style'?{recommendedStyleId:'invented-style'}:{})});
 const server=createServer(async(req,res)=>{
  calls++;for await(const part of req){void part}
  res.writeHead(200,{'content-type':'application/json'});
  res.end(JSON.stringify({id:'actual-sdk-unit',object:'chat.completion',created:1,model:'local-test-model',choices:[{index:0,message:{role:'assistant',content},finish_reason:'stop'}],...(mode==='missing'?{}:{usage:{prompt_tokens:90,completion_tokens:mode==='overrun'?70:40,total_tokens:mode==='overrun'?160:130}})}));
 });
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address();if(!address||typeof address==='string')throw Error('LOCAL_SERVER_FAILED');
 const root=await mkdtemp(join(tmpdir(),'vb-sdk-usage-'));
 try{
  vi.stubEnv('MODEL_PROVIDER','openai-compatible');vi.stubEnv('MODEL_BASE_URL','http://127.0.0.1:'+address.port+'/v1');vi.stubEnv('MODEL_API_KEY','local-unit-only');vi.stubEnv('VIDEO_DIRECTOR_MODEL','local-test-model');
  const store=new FileStore(root),limits={projectCalls:10,projectInputTokens:10000,projectOutputTokens:10000,dailyCalls:20};
  const r=(await reserveModelBudget(store,'project','one',{inputTokens:100,outputTokens:50},limits)).reservation;
  const invoke=()=>withAccountedModel(store,r,()=>runDirector(initialUnderstanding(),[],50));
  if(mode==='known'){
   await expect(invoke()).resolves.toMatchObject({reply:'你希望给谁看？'});
   const counter=(await store.readFresh<{accounting:Record<string,{state:string;inputTokens:number;outputTokens:number}>}>('projects/project/budget')).value;
   expect(counter.accounting[r.id]).toMatchObject({state:'settled',inputTokens:90,outputTokens:40});
  }else if(mode==='invalid_style'){
   await expect(invoke()).rejects.toThrow('STYLE_INVALID');
   const counter=(await store.readFresh<{accounting:Record<string,{state:string;inputTokens:number;outputTokens:number}>}>('projects/project/budget')).value;
   expect(counter.accounting[r.id]).toMatchObject({state:'settled',inputTokens:90,outputTokens:40});
  }else{
   await expect(invoke()).rejects.toThrow(mode==='overrun'?'MODEL_BUDGET_OVERRUN':'MODEL_USAGE_INVALID');
   await expect(reserveModelBudget(new FileStore(root),'project','two',{inputTokens:1,outputTokens:1},limits)).rejects.toThrow(mode==='overrun'?'MODEL_BUDGET_OVERRUN':'MODEL_USAGE_UNCERTAIN');
  }
  expect(calls).toBe(1);
  await expect(invoke()).rejects.toThrow('MODEL_ATTEMPT_ALREADY_STARTED');expect(calls).toBe(1);
 }finally{vi.unstubAllEnvs();await new Promise<void>(resolve=>server.close(()=>resolve()));await rm(root,{recursive:true,force:true})}
});
it.each(['generate','stream'] as const)('rechecks Director authorization after accounting starts and before %s HTTP',async mode=>{
 const {runDirectorStream}=await import('@/mastra/video/director');let calls=0,checks=0;
 const server=createServer(async(req,res)=>{calls++;for await(const part of req){void part}res.writeHead(400,{'content-type':'application/json'});res.end(JSON.stringify({error:{message:'must not reach provider'}}))});
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address();if(!address||typeof address==='string')throw Error('LOCAL_SERVER_FAILED');
 const root=await mkdtemp(join(tmpdir(),'vb-director-fence-'));
 const env={MODEL_PROVIDER:'openai-compatible',MODEL_BASE_URL:'http://127.0.0.1:'+address.port+'/v1',MODEL_API_KEY:'unit-only',VIDEO_DIRECTOR_MODEL:'local-unit'};
 try{
  for(const [k,v] of Object.entries(env))vi.stubEnv(k,v);
  const store=new FileStore(root),r=(await reserveModelBudget(store,'project','one',{inputTokens:100,outputTokens:50},{projectCalls:10,projectInputTokens:10000,projectOutputTokens:10000,dailyCalls:20})).reservation;
  const hooks={assertActive:async()=>{checks++;if(checks===2)throw Error('ACCESS_NOT_FOUND')}};
  await expect(withAccountedModel(store,r,()=>mode==='generate'?runDirector(initialUnderstanding(),[],50,hooks):runDirectorStream(initialUnderstanding(),[],50,async()=>{},env,hooks))).rejects.toThrow('ACCESS_NOT_FOUND');
  expect(calls).toBe(0);expect(checks).toBe(2);expect((await store.readFresh<{accounting:Record<string,{state:string}>}>('projects/project/budget')).value.accounting[r.id].state).toBe('unknown');
 }finally{vi.unstubAllEnvs();await new Promise<void>(resolve=>server.close(()=>resolve()));await rm(root,{recursive:true,force:true})}
});
