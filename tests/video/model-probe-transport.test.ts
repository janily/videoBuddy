import {expect,it,vi} from 'vitest';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {recordModelRequests} from '../../scripts/video/helpers/real-probe';

const env={MODEL_BASE_URL:'https://provider.invalid/v1',MODEL_API_KEY:'private-unit-key'};
it('rejects invalid timeout and call limits before installing a fetch wrapper',()=>{
 const original=globalThis.fetch;
 for(const timeoutMs of [0,-1,NaN,Infinity,900001,1.5])expect(()=>recordModelRequests(env,'/unused',1,{timeoutMs})).toThrow('MODEL_PROBE_LIMIT_INVALID');
 for(const calls of [0,-1,NaN,Infinity,1.5])expect(()=>recordModelRequests(env,'/unused',calls)).toThrow('MODEL_PROBE_LIMIT_INVALID');
 expect(globalThis.fetch).toBe(original);
});
it('uses the selected deadline, preserves caller cancellation and records unknown attempts without inventing usage',async()=>{
 const root=await mkdtemp(join(tmpdir(),'vb-probe-timeout-'));
 vi.stubGlobal('fetch',async(_input:unknown,init?:RequestInit)=>new Promise<Response>((_resolve,reject)=>{
  const signal=init!.signal!;
  if(signal.aborted)reject(signal.reason);
  else signal.addEventListener('abort',()=>reject(signal.reason),{once:true});
 }));
 const transport=recordModelRequests(env,root,3,{timeoutMs:20});
 try{
  const keepAlive=setTimeout(()=>{},1000);
  try{await expect(fetch(env.MODEL_BASE_URL+'/chat/completions',{body:'{"model":"unit"}'})).rejects.toMatchObject({name:'TimeoutError'})}finally{clearTimeout(keepAlive)}
  const signal=AbortSignal.abort(new DOMException('caller stopped','AbortError'));
  await expect(fetch(env.MODEL_BASE_URL+'/chat/completions',{body:'{"model":"unit"}',signal})).rejects.toMatchObject({name:'AbortError'});
  await expect(fetch(new Request(env.MODEL_BASE_URL+'/chat/completions',{signal}))).rejects.toMatchObject({name:'AbortError'});
  expect(transport.requests[0]).toMatchObject({timeoutMs:20,errorName:'TimeoutError'});
  expect(transport.requests[1]).toMatchObject({errorName:'AbortError'});
  for(const entry of transport.requests){expect(entry.startedAt).toBeTruthy();expect(entry.finishedAt).toBeTruthy();expect(entry.usage).toBeUndefined();expect(entry.status).toBeUndefined()}
  await expect(fetch(env.MODEL_BASE_URL+'/chat/completions',{body:'{}'})).rejects.toThrow('MODEL_PROBE_CALL_LIMIT');
 }finally{transport.restore();vi.unstubAllGlobals();await rm(root,{recursive:true,force:true})}
});
it('saves only redacted response evidence and excludes rejected destinations from paid attempts',async()=>{
 const root=await mkdtemp(join(tmpdir(),'vb-probe-response-'));
 vi.stubGlobal('fetch',async()=>new Response(JSON.stringify({id:'response-unit',text:env.MODEL_API_KEY,usage:{prompt_tokens:12,completion_tokens:6}})));
 const transport=recordModelRequests(env,root,1);
 try{
  await expect(fetch('https://other.invalid/v1/chat/completions')).rejects.toThrow('MODEL_PROBE_UNEXPECTED_DESTINATION');
  expect(transport.requests).toHaveLength(0);
  await fetch(env.MODEL_BASE_URL+'/chat/completions',{body:'{"model":"unit"}'});await transport.flush();
  const entry=transport.requests[0];expect(entry).toMatchObject({timeoutMs:120000,status:200,usage:{prompt_tokens:12,completion_tokens:6}});
  expect(await readFile(join(root,entry.responseFile!),'utf8')).not.toContain(env.MODEL_API_KEY);
 }finally{transport.restore();vi.unstubAllGlobals();await rm(root,{recursive:true,force:true})}
});
it('retains HTTP status and body failure without letting diagnostic flush replace the original failure report',async()=>{
 const root=await mkdtemp(join(tmpdir(),'vb-probe-body-'));
 vi.stubGlobal('fetch',async()=>new Response(new ReadableStream({start(controller){controller.error(new DOMException('body timed out','TimeoutError'))}})));
 const transport=recordModelRequests(env,root,1);
 try{
  const response=await fetch(env.MODEL_BASE_URL+'/chat/completions',{body:'{"model":"unit"}'});
  await expect(response.text()).rejects.toMatchObject({name:'TimeoutError'});
  await expect(transport.flush()).resolves.toHaveLength(1);
  expect(transport.requests[0]).toMatchObject({status:200,errorName:'TimeoutError'});
  expect(transport.requests[0].finishedAt).toBeTruthy();expect(transport.requests[0].usage).toBeUndefined();expect(transport.requests[0].responseFile).toBeUndefined();
 }finally{transport.restore();vi.unstubAllGlobals();await rm(root,{recursive:true,force:true})}
});
