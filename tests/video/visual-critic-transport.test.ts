import {expect,it,vi} from 'vitest';
import {createServer} from 'node:http';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {runVisualCritic} from '@/mastra/video/critic';
import {getStyle} from '@/services/video/styles/registry';
import {visualReviewContext} from '@/contracts/video/visual-review';
import {FileStore} from '@/services/video/storage/file-store';
import {reserveModelBudget} from '@/services/video/budget/model-budget';
import {withAccountedModel} from '@/services/video/budget/model-call';
import {recordModelRequests} from '../../scripts/video/helpers/real-probe';

it('sends exact decoded PNG bytes through native Mastra multimodal transport and accounts read-only review once',async()=>{
 const image=await readFile('docs/engineering/evidence/native-frame-3.png'),sha256=createHash('sha256').update(image).digest('hex'),style=getStyle('crayon-book');
 const context=visualReviewContext({filmSha256:'b'.repeat(64),filmSpecSha256:'a'.repeat(64),styleSlug:style.slug,styleRulesHash:style.rulesHash,round:1,frames:[{id:'frame-324',frame:324,sha256,bytes:image.length}],facts:[]});
 const response={schemaVersion:1,...context,scope:'sampled_frames',observations:[{frameId:'frame-324',visibleText:['上海青禾社'],issues:[{kind:'clipped_text',severity:'blocking',description:'所示地点尚未完整显示'}]}],facts:[],style:{result:'not_checked',frameIds:['frame-324'],reason:'单帧不足判断全片风格'},readability:{result:'fail',frameIds:['frame-324'],reason:'地点未完整显示'}};
 const {frames:unused,...result}=response;void unused;
 let calls=0;const received:unknown[]=[];
 const server=createServer(async(req,res)=>{
  calls++;const parts:Buffer[]=[];for await(const part of req)parts.push(part);received.push(JSON.parse(Buffer.concat(parts).toString()));
  res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({id:'local-critic',object:'chat.completion',model:'local-unit',created:1,choices:[{index:0,message:{role:'assistant',content:JSON.stringify(result)},finish_reason:'stop'}],usage:{prompt_tokens:120,completion_tokens:60,total_tokens:180}}));
 });
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address();if(!address||typeof address==='string')throw Error('LOCAL_SERVER_FAILED');
 const root=await mkdtemp(join(tmpdir(),'vb-critic-http-'));
 try{
  const env={MODEL_PROVIDER:'openai-compatible',MODEL_BASE_URL:'http://127.0.0.1:'+address.port+'/v1',MODEL_API_KEY:'local-unit-only',VIDEO_CRITIC_MODEL:'local-unit'},images=new Map([['frame-324',image]]);
  await expect(runVisualCritic(context,new Map([['frame-324',Buffer.from('wrong')]]),1000,env)).rejects.toThrow('CRITIC_IMAGE_CHANGED');expect(calls).toBe(0);
  const store=new FileStore(root),r=(await reserveModelBudget(store,'project','critic',{inputTokens:1000,outputTokens:1000},{projectCalls:1,projectInputTokens:10000,projectOutputTokens:10000,dailyCalls:1})).reservation;
  const transport=recordModelRequests(env,root,1);let review;
  try{review=await withAccountedModel(store,r,()=>runVisualCritic(context,images,1000,env))}finally{await transport.flush();transport.restore()}
  expect(transport.requests).toHaveLength(1);
  expect(review.readability.result).toBe('fail');expect(calls).toBe(1);
  const body=JSON.stringify(received[0]);expect(body).toContain('data:image/png;base64,'+image.toString('base64'));expect(body).not.toContain('local-unit-only');
  expect((await store.readFresh<{accounting:Record<string,{state:string;inputTokens:number;outputTokens:number}>}>('projects/project/budget')).value.accounting[r.id]).toMatchObject({state:'settled',inputTokens:120,outputTokens:60});
 }finally{await new Promise<void>(resolve=>server.close(()=>resolve()));await rm(root,{recursive:true,force:true})}
});
it('checks cancellation after durable model accounting before making a transport request',async()=>{
 const image=await readFile('docs/engineering/evidence/native-frame-3.png'),style=getStyle('crayon-book'),context=visualReviewContext({filmSha256:'b'.repeat(64),filmSpecSha256:'a'.repeat(64),styleSlug:style.slug,styleRulesHash:style.rulesHash,round:1,frames:[{id:'frame-324',frame:324,sha256:createHash('sha256').update(image).digest('hex'),bytes:image.length}],facts:[]});
 const root=await mkdtemp(join(tmpdir(),'vb-critic-fence-'));let requests=0,checks=0;
 const env={MODEL_PROVIDER:'openai-compatible',MODEL_BASE_URL:'http://127.0.0.1:9/v1',MODEL_API_KEY:'local-unit-only',VIDEO_CRITIC_MODEL:'local-unit'};
 vi.stubGlobal('fetch',async()=>{requests++;throw Error('UNEXPECTED_TRANSPORT')});
 try{
  const store=new FileStore(root),reservation=(await reserveModelBudget(store,'project','critic-fence',{inputTokens:1000,outputTokens:1000},{projectCalls:1,projectInputTokens:10000,projectOutputTokens:10000,dailyCalls:1})).reservation;
  await expect(withAccountedModel(store,reservation,()=>runVisualCritic(context,new Map([['frame-324',image]]),1000,env,{assertActive:async()=>{checks++;if(checks===2)throw Error('RENDER_FENCED')}}))).rejects.toThrow('RENDER_FENCED');
  expect(checks).toBe(2);expect(requests).toBe(0);
  // An already-started durable attempt remains conservative/unknown; this
  // cancellation does not silently refund or reset the billing gate.
  expect((await store.readFresh<{accounting:Record<string,{state:string}>}>('projects/project/budget')).value.accounting[reservation.id].state).toBe('unknown');
 }finally{vi.unstubAllGlobals();await rm(root,{recursive:true,force:true})}
});
