import {expect,it} from 'vitest';
import {createServer} from 'node:http';
import {randomUUID} from 'node:crypto';
import {initialUnderstanding} from '@/contracts/video/domain';
import {getStyle} from '@/services/video/styles/registry';
import {canonicalHash} from '@/services/video/domain/hash';
import {guardQuickVisualShot,quickClock,runQuickVisualShot} from '@/mastra/video/visual-shot';
import {guardTreatment} from '@/contracts/video/treatment';

const style=getStyle('crayon-book'),base=initialUnderstanding(),understanding={...base,briefVersion:1,subject:'活动预告',preferences:{...base.preferences,styleSlug:style.slug,durationSec:20}};
const shot={id:'opening',startFrame:0,endFrame:480,visualIntent:'绘出活动日期',scriptLine:'十月八日见。',factIds:[]};
const treatment={schemaVersion:1,briefVersion:1,styleSlug:style.slug,styleRulesHash:style.rulesHash,durationSec:20,aspect:'16:9',fps:24,summary:'活动预告',options:[{id:'a',concept:'绘图',visualApproach:'蜡笔',soundApproach:'鼓点',tradeoff:'动画多'},{id:'b',concept:'纸页',visualApproach:'翻页',soundApproach:'纸声',tradeoff:'人物少'},{id:'c',concept:'角色',visualApproach:'走路',soundApproach:'脚步',tradeoff:'造型复杂'}],selectedOptionId:'a',selectionReason:'信息清晰',shots:[shot],script:[shot.scriptLine]};
const plan=guardTreatment(treatment,understanding,style.rulesHash),timing=quickClock(plan);
const html='<!doctype html><html><meta charset="utf-8"><canvas id="c" width="1920" height="1080"></canvas><script>const c=document.getElementById("c"),x=c.getContext("2d");window.render=t=>{x.fillStyle="#f4efe3";x.fillRect(0,0,1920,1080);x.fillStyle="#394c73";x.fillText("十月八日见",100+10*Math.sin(t),200)};window.READY=true;</script></html>';
const timingHash=canonicalHash(timing),result={schemaVersion:1,briefVersion:1,styleSlug:style.slug,styleRulesHash:style.rulesHash,timingDraftHash:timingHash,shotId:'opening',startFrame:0,endFrame:480,factIds:[],sourceHtml:html,assetIds:[],seed:0,direction:{purpose:'活动日期',framing:'全景',camera:'静止',actorIds:[]}};

it('T06 Visual only accepts pinned shot, facts, timing and deterministic offline source',()=>{
 expect(guardQuickVisualShot(result,understanding,plan,timingHash,0)).toMatchObject({shotId:'opening',sourceHtml:html});
 expect(()=>guardQuickVisualShot({...result,endFrame:479},understanding,plan,timingHash,0)).toThrow('VISUAL_SOURCE_INVALID');
 expect(()=>guardQuickVisualShot({...result,sourceHtml:html.replace('Math.sin(t)','Math.random()')},understanding,plan,timingHash,0)).toThrow('VISUAL_SOURCE_INVALID');
 expect(()=>guardQuickVisualShot({...result,sourceHtml:html.replace('window.READY=true','setInterval(()=>{},100)')},understanding,plan,timingHash,0)).toThrow('VISUAL_SOURCE_INVALID');
 expect(()=>guardQuickVisualShot({...result,assetIds:[randomUUID()]},understanding,plan,timingHash,0)).toThrow('VISUAL_SOURCE_INVALID');
 expect(()=>guardQuickVisualShot({...result,seed:9},understanding,plan,timingHash,10)).toThrow('VISUAL_SOURCE_INVALID');
 expect(()=>guardQuickVisualShot({...result,direction:{purpose:'活动日期',framing:'全景',camera:'静止',actorIds:['a','a']}},understanding,plan,timingHash,0)).toThrow('VISUAL_SOURCE_INVALID');
});
it('accepts ordinary JS comments while retaining URL and executable API checks in actual code and strings',()=>{
 const commented=html.replace('<script>','<script>// drawing layout\n/* Explain offline policy: do not fetch https://example.test */\n');
 expect(guardQuickVisualShot({...result,sourceHtml:commented},understanding,plan,timingHash,0).sourceHtml).toBe(commented);
 const literal=html.replace('<script>','<script>const note="/* https://example.test */";');
 expect(()=>guardQuickVisualShot({...result,sourceHtml:literal},understanding,plan,timingHash,0)).toThrow('VISUAL_SOURCE_INVALID');
 const htmlCommentLiteral=html.replace('<script>','<script>const note="<!-- https://example.test -->";');
 expect(()=>guardQuickVisualShot({...result,sourceHtml:htmlCommentLiteral},understanding,plan,timingHash,0)).toThrow('VISUAL_SOURCE_INVALID');
 const hiddenCall=html.replace('<script>','<script>/* documentation */fetch("/private");');
 expect(()=>guardQuickVisualShot({...result,sourceHtml:hiddenCall},understanding,plan,timingHash,0)).toThrow('VISUAL_SOURCE_INVALID');
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
  const output=await runQuickVisualShot(imageUnderstanding,plan,'opening',{seed:0,env:{MODEL_PROVIDER:'openai-compatible',MODEL_BASE_URL:`http://127.0.0.1:${address.port}/v1`,MODEL_API_KEY:'local-test-only',VIDEO_VISUAL_MODEL:'test-model'},imageAssets:[{id:imageId,mime:'image/png'}]});
  expect(JSON.stringify(requests[0]).includes('/assets/'+imageId+'.bin')).toBe(true);expect(output.sourceHtml).toBe(html);expect(requests.length).toBeGreaterThan(0);expect(JSON.stringify(requests[0])).toContain(style.rulesHash);expect(JSON.stringify(requests[0])).toContain(timingHash);
 }finally{await new Promise<void>(resolve=>server.close(()=>resolve()))}
});
it('rejects an undeclared image catalog before configuring or sending a model request',async()=>{
 await expect(runQuickVisualShot(understanding,plan,'opening',{seed:0,env:{},imageAssets:[{id:randomUUID(),mime:'image/png'}]})).rejects.toThrow('VISUAL_ASSET_INVALID');
});
it('validates the immutable first-shot continuity reference before any model call',async()=>{
 const next=guardTreatment({...treatment,shots:[{...shot,endFrame:240},{...shot,id:'closing',startFrame:240}],script:[shot.scriptLine,shot.scriptLine]},understanding,style.rulesHash);
 const reference={...result,schemaVersion:1 as const,endFrame:240,timingDraftHash:canonicalHash(quickClock(next))};
 await expect(runQuickVisualShot(understanding,next,'closing',{seed:0,env:{},continuitySource:{...reference,seed:1}})).rejects.toThrow('VISUAL_SOURCE_INVALID');
 await expect(runQuickVisualShot(understanding,next,'closing',{seed:0,env:{},continuitySource:{...reference,shotId:'closing',startFrame:240,endFrame:480}})).rejects.toThrow('VISUAL_CONTINUITY_INVALID');
});
