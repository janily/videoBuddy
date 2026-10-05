import {it,expect} from 'vitest';
import {createServer} from 'node:http';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {contentReviewContext} from '@/contracts/video/content-review';
import {canonicalHash} from '@/services/video/domain/hash';
import {runContentCritic} from '@/mastra/video/content-critic';
import {FileStore} from '@/services/video/storage/file-store';
import {reserveModelBudget} from '@/services/video/budget/model-budget';
import {withAccountedModel} from '@/services/video/budget/model-call';
it.each(['png','lossless_webp'] as const)('rejects changed evidence and sends verified words and %s through native Mastra once',async encoding=>{
 const image=await readFile('docs/engineering/evidence/native-frame-3.png'),facts=[{id:'flow',text:'先播种再浇水。',sourceRefs:[{type:'user_message' as const,id:'source'}],status:'confirmed' as const,mustInclude:true,critical:true}],context=contentReviewContext({filmSha256:'a'.repeat(64),filmSpecSha256:'b'.repeat(64),factsManifestSha256:canonicalHash({schemaVersion:1,facts}),fps:24,totalFrames:480,facts,...(encoding==='lossless_webp'?{imageEncoding:encoding}:{}),frames:[{id:'frame',frame:324,sha256:createHash('sha256').update(image).digest('hex'),bytes:image.length}],transcripts:[{id:'line',startSample:0,endSample:48000,audioSha256:'c'.repeat(64),text:'先播种。',verification:'pass'}]});
 // This local provider fixture tests transport/usage, never actual semantic QA.
 const result={schemaVersion:1,contextSha256:context.contextSha256,scope:'provided_frames_and_verified_transcripts',observations:[{frameId:'frame',description:'样本不足以判断播种后的浇水。',visibleText:[]}],facts:[{factId:'flow',result:'not_checked',coverage:'partial',reason:'只提供了播种转写，无法确认整个流程。',evidence:[{kind:'transcript',transcriptId:'line',quote:'先播种。'}],literalChecks:[{sourceExcerpt:'先播种再浇水。',result:'not_checked',evidence:[],reason:'实际输入没有完整来源文字。'}]}],conflicts:[]};
 let calls=0,body:Record<string,unknown>|undefined;const server=createServer(async(req,res)=>{calls++;const parts=[];for await(const part of req)parts.push(part);body=JSON.parse(Buffer.concat(parts).toString());res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({id:'local-content',object:'chat.completion',created:1,model:'local-unit',choices:[{index:0,message:{role:'assistant',content:JSON.stringify(result)},finish_reason:'stop'}],usage:{prompt_tokens:123,completion_tokens:67,total_tokens:190}}))});
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address();if(!address||typeof address==='string')throw Error('LOCAL_SERVER_FAILED');
 const root=await mkdtemp(join(tmpdir(),'vb-content-http-'));
 try{
  const env={MODEL_PROVIDER:'openai-compatible',MODEL_BASE_URL:`http://127.0.0.1:${address.port}/v1`,MODEL_API_KEY:'local-unit-only',VIDEO_CRITIC_MODEL:'local-unit'};
  await expect(runContentCritic(context,new Map([['frame',Buffer.from('wrong')]]),1000,env)).rejects.toThrow('CONTENT_IMAGE_CHANGED');expect(calls).toBe(0);
  const store=new FileStore(root),r=(await reserveModelBudget(store,'project','content',{inputTokens:1000,outputTokens:1000},{projectCalls:1,projectInputTokens:10000,projectOutputTokens:10000,dailyCalls:1})).reservation;
  const review=await withAccountedModel(store,r,()=>runContentCritic(context,new Map([['frame',image]]),1000,env));
  expect(review.facts[0].result).toBe('not_checked');expect(calls).toBe(1);const serialized=JSON.stringify(body);if(encoding==='png')expect(serialized).toContain(image.toString('base64'));else{const match=serialized.match(/data:image\/webp;base64,([A-Za-z0-9+/=]+)/);expect(match).not.toBeNull();const sharp=(await import('sharp')).default;const encoded=Buffer.from(match![1],'base64');expect(await sharp(encoded).ensureAlpha().raw().toBuffer()).toEqual(await sharp(image).ensureAlpha().raw().toBuffer());}expect(serialized).toContain('先播种。');expect(serialized).toContain('先播种再浇水。');
  expect((await store.readFresh<{accounting:Record<string,unknown>}>('projects/project/budget')).value.accounting[r.id]).toMatchObject({state:'settled',inputTokens:123,outputTokens:67});
 }finally{await new Promise<void>(resolve=>server.close(()=>resolve()));await rm(root,{recursive:true,force:true})}
},15000);
it('fences a started content attempt before HTTP without refunding its unknown usage',async()=>{
 const image=await readFile('docs/engineering/evidence/native-frame-3.png'),context=contentReviewContext({filmSha256:'a'.repeat(64),filmSpecSha256:'b'.repeat(64),factsManifestSha256:canonicalHash({schemaVersion:1,facts:[]}),fps:24,totalFrames:480,facts:[],frames:[{id:'frame',frame:324,sha256:createHash('sha256').update(image).digest('hex'),bytes:image.length}],transcripts:[]}),root=await mkdtemp(join(tmpdir(),'vb-content-fence-'));
 let requests=0,checks=0;const saved=globalThis.fetch;globalThis.fetch=async()=>{requests++;return new Response(JSON.stringify({id:'unit-fence',object:'chat.completion',created:1,model:'local-unit',choices:[{index:0,message:{role:'assistant',content:JSON.stringify({schemaVersion:1,contextSha256:context.contextSha256,scope:'provided_frames_and_verified_transcripts',observations:[{frameId:'frame',description:'本地协议测试。',visibleText:[]}],facts:[],conflicts:[]})},finish_reason:'stop'}],usage:{prompt_tokens:123,completion_tokens:67,total_tokens:190}}),{headers:{'content-type':'application/json'}})};
 try{
  const store=new FileStore(root),r=(await reserveModelBudget(store,'project','content-fence',{inputTokens:1000,outputTokens:1000},{projectCalls:1,projectInputTokens:10000,projectOutputTokens:10000,dailyCalls:1})).reservation;
  await expect(withAccountedModel(store,r,()=>runContentCritic(context,new Map([['frame',image]]),1000,{MODEL_PROVIDER:'openai-compatible',MODEL_BASE_URL:'http://127.0.0.1:1/v1',MODEL_API_KEY:'local-unit-only',VIDEO_CRITIC_MODEL:'local-unit'},{assertActive:async()=>{if(++checks===2)throw Error('RENDER_FENCED')}}))).rejects.toThrow('RENDER_FENCED');
  expect(requests).toBe(0);expect((await store.readFresh<{accounting:Record<string,unknown>}>('projects/project/budget')).value.accounting[r.id]).toMatchObject({state:'unknown'});
 }finally{globalThis.fetch=saved;await rm(root,{recursive:true,force:true})}
});
