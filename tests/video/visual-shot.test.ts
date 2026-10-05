import {expect,it} from 'vitest';
import {createServer} from 'node:http';
import {randomUUID} from 'node:crypto';
import {initialUnderstanding} from '@/contracts/video/domain';
import {getStyle} from '@/services/video/styles/registry';
import {canonicalHash} from '@/services/video/domain/hash';
import {guardVisualShot} from '@/contracts/video/visual-shot';
import {runVisualShot} from '@/mastra/video/visual-shot';
import {TimingDraftSchema} from '@/services/video/preview/timing-draft';

const style=getStyle('crayon-book'),base=initialUnderstanding(),understanding={...base,briefVersion:1,subject:'活动预告',preferences:{...base.preferences,styleSlug:style.slug,durationSec:20}};
const shot={id:'opening',startFrame:0,endFrame:480,visualIntent:'绘出活动日期',scriptLine:'十月八日见。',factIds:[]};
const treatment={schemaVersion:1,briefVersion:1,styleSlug:style.slug,styleRulesHash:style.rulesHash,durationSec:20,aspect:'16:9',fps:24,summary:'活动预告',options:[{id:'a',concept:'绘图',visualApproach:'蜡笔',soundApproach:'鼓点',tradeoff:'动画多'},{id:'b',concept:'纸页',visualApproach:'翻页',soundApproach:'纸声',tradeoff:'人物少'},{id:'c',concept:'角色',visualApproach:'走路',soundApproach:'脚步',tradeoff:'造型复杂'}],selectedOptionId:'a',selectionReason:'信息清晰',shots:[shot],script:[shot.scriptLine]};
const timing=TimingDraftSchema.parse({schemaVersion:1,briefVersion:1,styleSlug:style.slug,styleRulesHash:style.rulesHash,durationMs:20000,totalFrames:480,fps:24,sampleRate:48000,shots:[{id:'opening',startFrame:0,endFrame:480,visualIntent:shot.visualIntent,factIds:[]}],narration:[],captions:[],track:{outputPath:'/tmp/audio/track.wav',sha256:'a'.repeat(64),samples:960000,runtimeDigest:'b'.repeat(64),silence:true},font:null,qualityStatus:'semantic_not_checked'});
const html='<!doctype html><html><meta charset="utf-8"><canvas id="c" width="1920" height="1080"></canvas><script>const c=document.getElementById("c"),x=c.getContext("2d");window.render=t=>{x.fillStyle="#f4efe3";x.fillRect(0,0,1920,1080);x.fillStyle="#394c73";x.fillText("十月八日见",100+10*Math.sin(t),200)};window.READY=true;</script></html>';
const timingHash=canonicalHash(timing),result={schemaVersion:1,briefVersion:1,styleSlug:style.slug,styleRulesHash:style.rulesHash,timingDraftHash:timingHash,shotId:'opening',startFrame:0,endFrame:480,factIds:[],sourceHtml:html,assetIds:[]};

it('T06 Visual only accepts pinned shot, facts, timing and deterministic offline source',()=>{
 expect(guardVisualShot(result,understanding,treatment,timing,timingHash)).toMatchObject({shotId:'opening',sourceHtml:html});
 expect(()=>guardVisualShot({...result,endFrame:479},understanding,treatment,timing,timingHash)).toThrow('VISUAL_BASELINE_CHANGED');
 expect(()=>guardVisualShot({...result,sourceHtml:html.replace('Math.sin(t)','Math.random()')},understanding,treatment,timing,timingHash)).toThrow('VISUAL_SOURCE_INVALID');
 expect(()=>guardVisualShot({...result,sourceHtml:html.replace('window.READY=true','setInterval(()=>{},100)')},understanding,treatment,timing,timingHash)).toThrow('VISUAL_SOURCE_INVALID');
 expect(()=>guardVisualShot({...result,assetIds:[randomUUID()]},understanding,treatment,timing,timingHash)).toThrow('VISUAL_ASSET_INVALID');
 expect(()=>guardVisualShot({...result,seed:9},understanding,treatment,timing,timingHash,10)).toThrow('VISUAL_BASELINE_CHANGED');
 expect(()=>guardVisualShot({...result,direction:{purpose:'活动日期',framing:'全景',camera:'静止',actorIds:['a','a']}},understanding,treatment,timing,timingHash)).toThrow('VISUAL_SOURCE_INVALID');
});
it('accepts ordinary JS comments while retaining URL and executable API checks in actual code and strings',()=>{
 const commented=html.replace('<script>','<script>// drawing layout\n/* Explain offline policy: do not fetch https://example.test */\n');
 expect(guardVisualShot({...result,sourceHtml:commented},understanding,treatment,timing,timingHash).sourceHtml).toBe(commented);
 const literal=html.replace('<script>','<script>const note="/* https://example.test */";');
 expect(()=>guardVisualShot({...result,sourceHtml:literal},understanding,treatment,timing,timingHash)).toThrow('VISUAL_SOURCE_INVALID');
 const htmlCommentLiteral=html.replace('<script>','<script>const note="<!-- https://example.test -->";');
 expect(()=>guardVisualShot({...result,sourceHtml:htmlCommentLiteral},understanding,treatment,timing,timingHash)).toThrow('VISUAL_SOURCE_INVALID');
 const hiddenCall=html.replace('<script>','<script>/* documentation */fetch("/private");');
 expect(()=>guardVisualShot({...result,sourceHtml:hiddenCall},understanding,treatment,timing,timingHash)).toThrow('VISUAL_SOURCE_INVALID');
});
it('T06 Visual sends the selected STYLE and real timing through the compatible model adapter',async()=>{
 const requests:Record<string,unknown>[]=[];
 const server=createServer(async(req,res)=>{
  let body='';for await(const part of req)body+=part;const parsed=JSON.parse(body) as Record<string,unknown>;requests.push(parsed);
  const content=JSON.stringify({...result,seed:0,direction:{purpose:'活动日期',framing:'全景',camera:'静止',actorIds:[]}});
  if(!parsed.stream){res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({id:'visual-test',object:'chat.completion',created:1,model:'test-model',choices:[{index:0,message:{role:'assistant',content},finish_reason:'stop'}],usage:{prompt_tokens:100,completion_tokens:100,total_tokens:200}}));return}
  res.writeHead(200,{'content-type':'text/event-stream'});
  res.write('data: '+JSON.stringify({id:'visual-test',object:'chat.completion.chunk',created:1,model:'test-model',choices:[{index:0,delta:{role:'assistant',content},finish_reason:null}]})+'\n\n');
  res.end('data: '+JSON.stringify({id:'visual-test',object:'chat.completion.chunk',created:1,model:'test-model',choices:[{index:0,delta:{},finish_reason:'stop'}],usage:{prompt_tokens:100,completion_tokens:100,total_tokens:200}})+'\n\ndata: [DONE]\n\n');
 });
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address();if(!address||typeof address==='string')throw Error('TEST_SERVER_FAILED');
 try{
  const imageId=randomUUID(),imageUnderstanding={...understanding,assetUses:[{assetId:imageId,purpose:'Protocol image',required:true}]};
  const output=await runVisualShot(imageUnderstanding,treatment,timing,timingHash,'opening',12000,{MODEL_PROVIDER:'openai-compatible',MODEL_BASE_URL:`http://127.0.0.1:${address.port}/v1`,MODEL_API_KEY:'local-test-only',VIDEO_VISUAL_MODEL:'test-model'},0,[{id:imageId,mime:'image/png'}]);
  expect(JSON.stringify(requests[0]).includes('/assets/'+imageId+'.bin')).toBe(true);expect(output.sourceHtml).toBe(html);expect(requests.length).toBeGreaterThan(0);expect(JSON.stringify(requests[0])).toContain(style.rulesHash);expect(JSON.stringify(requests[0])).toContain(timingHash);
 }finally{await new Promise<void>(resolve=>server.close(()=>resolve()))}
});
it('rejects an undeclared image catalog before configuring or sending a model request',async()=>{
 await expect(runVisualShot(understanding,treatment,timing,timingHash,'opening',12000,{},0,[{id:randomUUID(),mime:'image/png'}])).rejects.toThrow('VISUAL_ASSET_INVALID');
});
