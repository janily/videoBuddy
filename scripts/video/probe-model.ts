import {randomUUID} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {initialUnderstanding} from '../../src/contracts/video/domain';
import {runDirector,applyUnderstandingPatch} from '../../src/mastra/video/director';
import {configuredModel} from '../../src/mastra/video/model-adapter';

// Opt-in real-provider probe. Credentials are supplied by the invoking process, never recorded.
async function main(){
 if(!process.argv.includes('--real'))throw Error('REAL_MODEL_PROBE_OPT_IN_REQUIRED');
 configuredModel('director');
 const start=Date.now(),providerUrl=new URL(process.env.MODEL_BASE_URL!),original=globalThis.fetch,requests:Array<{stream:boolean;status?:number;usage?:unknown}>=[],reads:Promise<void>[]=[];
 globalThis.fetch=async(input,init)=>{
  const url=new URL(input instanceof Request?input.url:String(input));
  if(url.origin!==providerUrl.origin||url.pathname!==providerUrl.pathname.replace(/\/$/,'')+'/chat/completions')throw Error('MODEL_PROBE_UNEXPECTED_DESTINATION');
  if(requests.length>=1)throw Error('MODEL_PROBE_CALL_LIMIT');
  const raw=JSON.parse(String(init?.body||'{}')),entry:{stream:boolean;status?:number;usage?:unknown}={stream:raw.stream===true};requests.push(entry);
  const response=await original(input,{...init,signal:AbortSignal.any([AbortSignal.timeout(90000),...(init?.signal?[init.signal]:[])])});entry.status=response.status;
  reads.push(response.clone().text().then(body=>{
   if(response.headers.get('content-type')?.includes('event-stream')){
    for(const line of body.split(/\r?\n/)){if(!line.startsWith('data:'))continue;try{const event=JSON.parse(line.slice(5));if(event.usage)entry.usage=event.usage}catch{}}
   }else{try{entry.usage=JSON.parse(body).usage}catch{}}
  }));
  return response;
 };
 try{
  const id=randomUUID(),messages=[{id,role:'user' as const,text:'请做20秒横屏视频，主题是社区图书交换。活动时间是2026年10月8日，地点是上海青禾社区广场。中文旁白，手绘蜡笔风格。不要替我审批或开始正式制作。'}];
  const decision=await runDirector(initialUnderstanding(),messages),understanding=decision.understandingPatch?applyUnderstandingPatch(initialUnderstanding(),decision.understandingPatch,messages):initialUnderstanding();
  await Promise.all(reads);
  const evidence={executedAt:new Date().toISOString(),providerOrigin:providerUrl.origin,model:process.env.VIDEO_DIRECTOR_MODEL,actualModelCall:true,callCount:requests.length,requests,durationMs:Date.now()-start,decision,understanding,limits:'One actual Director guidance call, strict schema and source-authorized patch; not a 16-case behavior evaluation, movie or QA result.'};
  await mkdir(join('docs','engineering','evidence'),{recursive:true});
  await writeFile(join('docs','engineering','evidence','real-director-probe.json'),JSON.stringify(evidence,null,2)+'\n');
  console.log(JSON.stringify({status:'pass',model:evidence.model,callCount:requests.length,requests,action:decision.action,briefVersion:understanding.briefVersion,facts:understanding.facts.length}));
 }finally{globalThis.fetch=original}
}
main().catch(error=>{console.error(JSON.stringify({status:'fail',errorName:error?.name||'Error',errorCode:String(error?.message||'MODEL_PROBE_FAILED').replaceAll(process.env.MODEL_API_KEY||'missing-key','[redacted]').slice(0,300)}));process.exitCode=1});
