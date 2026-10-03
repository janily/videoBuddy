import {expect,it} from 'vitest';
import {createServer} from 'node:http';
import {randomUUID} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {runDirectorStream} from '@/mastra/video/director';
import {ProjectStore} from '@/services/video/storage/project-store';
import {FileStore} from '@/services/video/storage/file-store';
import {reserveModelBudget} from '@/services/video/budget/model-budget';
import {withAccountedModel} from '@/services/video/budget/model-call';
import type {Understanding} from '@/contracts/video/domain';

it.each([false,true])('forwards native fragments and settles usage before semantic validation (invalid style: %s)',async invalidStyle=>{
 expect(typeof runDirectorStream).toBe('function');
 const root=await mkdtemp(join(tmpdir(),'vb-director-stream-')),store=new FileStore(root),projects=new ProjectStore(store);
 const {projectId}=await projects.create('owner',{schemaVersion:5,clientCommandId:randomUUID(),clientCreateId:randomUUID()}),control=(await store.readFresh<import('@/contracts/video/project').ProjectControl>('projects/'+projectId+'/control')).value;
 const understanding=(await store.readFresh<Understanding>(control.understandingRef.key)).value,userId=randomUUID(),reply='你好🌱，正在理解你的想法。';
 const decision={action:'ask',reply,effect:'no_change',executionIntent:'none',evidenceMessageIds:[userId],...(invalidStyle?{recommendedStyleId:'fabricated-style'}:{})};
 const first='{"action":"ask","reply":"你好🌱，',rest=JSON.stringify(decision).slice(first.length);
 let release:()=>void=()=>{},finished=false,calls=0,body:Record<string,unknown>|undefined;
 const gate=new Promise<void>(resolve=>{release=resolve});
 const server=createServer(async(req,res)=>{
  calls++;const bytes:Buffer[]=[];for await(const part of req)bytes.push(part);body=JSON.parse(Buffer.concat(bytes).toString());
  res.writeHead(200,{'content-type':'text/event-stream'});
  const chunk=(content:string)=>'data: '+JSON.stringify({id:'unit-stream',object:'chat.completion.chunk',created:1,model:'local-unit',choices:[{index:0,delta:{content},finish_reason:null}]})+'\n\n';
  // Deliberately split the UTF-8 emoji across network writes.
  const bytesFirst=Buffer.from(chunk(first)),split=bytesFirst.indexOf(Buffer.from('🌱'))+2;
  res.write(bytesFirst.subarray(0,split));res.write(bytesFirst.subarray(split));
  await gate;finished=true;res.write(chunk(rest));
  res.write('data: '+JSON.stringify({id:'unit-stream',object:'chat.completion.chunk',created:1,model:'local-unit',choices:[{index:0,delta:{},finish_reason:'stop'}],usage:{prompt_tokens:50,completion_tokens:25,total_tokens:75}})+'\n\n');res.end('data: [DONE]\n\n');
 });
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address();if(!address||typeof address==='string')throw Error('LOCAL_SERVER_FAILED');
 try{
  const reservation=(await reserveModelBudget(store,projectId,'stream',{inputTokens:1000,outputTokens:1000},{projectCalls:1,projectInputTokens:10000,projectOutputTokens:10000,dailyCalls:1})).reservation,fragments:string[]=[];
  const task=withAccountedModel(store,reservation,()=>runDirectorStream(understanding,[{id:userId,role:'user',text:'做一段视频'}],1000,async fragment=>{if(!fragments.length)expect(finished).toBe(false);fragments.push(fragment);release()},{MODEL_PROVIDER:'openai-compatible',MODEL_BASE_URL:'http://127.0.0.1:'+address.port+'/v1',MODEL_API_KEY:'unit-only',VIDEO_DIRECTOR_MODEL:'local-unit'}));
  if(invalidStyle)await expect(task).rejects.toThrow('STYLE_INVALID');else expect((await task).reply).toBe(reply);expect(fragments.join('')).toBe(reply);expect(calls).toBe(1);expect(body?.stream).toBe(true);
  expect((await store.readFresh<{accounting:Record<string,{state:string;inputTokens:number;outputTokens:number}>}>('projects/'+projectId+'/budget')).value.accounting[reservation.id]).toMatchObject({state:'settled',inputTokens:50,outputTokens:25});
 }finally{release();server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));await rm(root,{recursive:true,force:true})}
},15000);
