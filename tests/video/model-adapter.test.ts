import {it,expect} from 'vitest';
import {createServer} from 'node:http';
import {createVideoAgent} from '@/mastra/video/model-adapter';
it('AT-001 installed Mastra calls the configured compatible protocol (local test provider, zero cloud calls)',async()=>{
 const bodies:Record<string,unknown>[]=[];
 const server=createServer(async(req,res)=>{
  let body='';for await(const chunk of req)body+=chunk;
  const parsed=JSON.parse(body);bodies.push(parsed);
  if(!parsed.stream){res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({id:'test',object:'chat.completion',created:1,model:'test-model',choices:[{index:0,message:{role:'assistant',content:'真实适配调用'},finish_reason:'stop'}],usage:{prompt_tokens:1,completion_tokens:1,total_tokens:2}}));return;}
  res.writeHead(200,{'content-type':'text/event-stream'});
  res.write('data: '+JSON.stringify({id:'test',object:'chat.completion.chunk',created:1,model:'test-model',choices:[{index:0,delta:{role:'assistant',content:'真实适配调用'},finish_reason:null}]})+'\n\n');
  res.write('data: '+JSON.stringify({id:'test',object:'chat.completion.chunk',created:1,model:'test-model',choices:[{index:0,delta:{},finish_reason:'stop'}],usage:{prompt_tokens:1,completion_tokens:1,total_tokens:2}})+'\n\n');res.end('data: [DONE]\n\n');
 });
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address();if(!address||typeof address==='string')throw Error();
 try{const agent=createVideoAgent('director','测试调用',{MODEL_PROVIDER:'openai-compatible',MODEL_BASE_URL:`http://127.0.0.1:${address.port}/v1`,MODEL_API_KEY:'test-only',VIDEO_DIRECTOR_MODEL:'test-model'});
  const response=await agent.generate('hello',{maxSteps:1});expect(response.text).toBe('真实适配调用');expect(bodies[0].model).toBe('test-model');
 }finally{await new Promise<void>(resolve=>server.close(()=>resolve()))}
});
