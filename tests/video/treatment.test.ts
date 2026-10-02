import{expect,it}from'vitest';
import{randomUUID}from'node:crypto';
import{createServer}from'node:http';
import{initialUnderstanding}from'@/contracts/video/domain';
import{guardTreatment,runTreatment,TreatmentPlanSchema}from'@/mastra/video/treatment';
import{getStyle}from'@/services/video/styles/registry';

const messageId=randomUUID(),style=getStyle('crayon-book'),fact={id:'date',text:'活动十月八日开始',sourceRefs:[{type:'user_message' as const,id:messageId}],status:'confirmed' as const,mustInclude:true,critical:true};
const understanding={...initialUnderstanding(),briefVersion:2,subject:'活动预告',sourceMessageIds:[messageId],facts:[fact],preferences:{...initialUnderstanding().preferences,durationSec:20,styleSlug:style.slug}};
const options=[
 {id:'a',concept:'画笔逐步绘出会场',visualApproach:'角色与场景逐帧出现',soundApproach:'轻快打击乐',tradeoff:'节奏较快'},
 {id:'b',concept:'观众跟随角色入场',visualApproach:'连续镜头追踪角色',soundApproach:'脚步与环境声',tradeoff:'角色动作成本高'},
 {id:'c',concept:'活动信息化为纸页',visualApproach:'纸页分层翻动',soundApproach:'纸张拟音',tradeoff:'人物表现较少'},
];
const shots=[{id:'opening',startFrame:0,endFrame:240,visualIntent:'绘出活动会场',scriptLine:'活动将在十月八日开始。',factIds:['date']},{id:'closing',startFrame:240,endFrame:480,visualIntent:'角色邀请观众',scriptLine:'欢迎来看看。',factIds:[]}];
const plan={schemaVersion:1,briefVersion:2,styleSlug:style.slug,styleRulesHash:style.rulesHash,durationSec:20,aspect:'16:9',fps:24,summary:'活动预告',options,selectedOptionId:'a',selectionReason:'可读信息与角色动作兼顾',shots,script:shots.map(shot=>shot.scriptLine)};

it('T06 treatment covers the confirmed fact with three distinct internal concepts and one full timeline',()=>{
 expect(guardTreatment(plan,understanding,style.rulesHash)).toMatchObject({selectedOptionId:'a',durationSec:20});
 expect(()=>guardTreatment({...plan,shots:[{...shots[0],factIds:[]},shots[1]]},understanding,style.rulesHash)).toThrow('TREATMENT_FACT_MISSING');
 expect(()=>guardTreatment({...plan,shots:[{...shots[0],factIds:['invented']},shots[1]]},understanding,style.rulesHash)).toThrow('TREATMENT_FACT_INVALID');
 expect(()=>guardTreatment({...plan,shots:[shots[0],{...shots[1],startFrame:241}]},understanding,style.rulesHash)).toThrow('TREATMENT_TIMELINE_INVALID');
 expect(()=>guardTreatment({...plan,options:[options[0],{...options[1],concept:options[0].concept},options[2]]},understanding,style.rulesHash)).toThrow('TREATMENT_OPTIONS_INVALID');
 expect(()=>guardTreatment({...plan,styleRulesHash:'b'.repeat(64)},understanding,style.rulesHash)).toThrow('TREATMENT_BASELINE_CHANGED');
 expect(()=>guardTreatment({...plan,script:['其他文案']},understanding,style.rulesHash)).toThrow('TREATMENT_SCRIPT_INVALID');
 expect(TreatmentPlanSchema.safeParse({...plan,html:'<script>window.READY=true</script>'}).success).toBe(false);
});
it('T06 sends the selected pinned STYLE and brief through the actual compatible model adapter',async()=>{
 const requests:Record<string,unknown>[]=[];
 const server=createServer(async(req,res)=>{
  let body='';for await(const chunk of req)body+=chunk;const parsed=JSON.parse(body) as Record<string,unknown>;requests.push(parsed);
  const content=JSON.stringify(plan);
  if(!parsed.stream){res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({id:'treatment-test',object:'chat.completion',created:1,model:'test-model',choices:[{index:0,message:{role:'assistant',content},finish_reason:'stop'}],usage:{prompt_tokens:100,completion_tokens:100,total_tokens:200}}));return}
  res.writeHead(200,{'content-type':'text/event-stream'});
  res.write('data: '+JSON.stringify({id:'treatment-test',object:'chat.completion.chunk',created:1,model:'test-model',choices:[{index:0,delta:{role:'assistant',content},finish_reason:null}]})+'\n\n');
  res.end('data: '+JSON.stringify({id:'treatment-test',object:'chat.completion.chunk',created:1,model:'test-model',choices:[{index:0,delta:{},finish_reason:'stop'}],usage:{prompt_tokens:100,completion_tokens:100,total_tokens:200}})+'\n\ndata: [DONE]\n\n');
 });
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address();if(!address||typeof address==='string')throw Error('TEST_SERVER_FAILED');
 try{
  const result=await runTreatment(understanding,5000,{MODEL_PROVIDER:'openai-compatible',MODEL_BASE_URL:`http://127.0.0.1:${address.port}/v1`,MODEL_API_KEY:'local-test-only',VIDEO_DIRECTOR_MODEL:'test-model'});
  expect(result.selectedOptionId).toBe('a');expect(requests.length).toBeGreaterThan(0);
  expect(JSON.stringify(requests[0])).toContain(style.rulesHash);
 }finally{await new Promise<void>(resolve=>server.close(()=>resolve()))}
});
