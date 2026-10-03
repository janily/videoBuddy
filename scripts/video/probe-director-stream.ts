import {mkdtemp,mkdir,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {FileStore} from '../../src/services/video/storage/file-store';
import {ProjectStore} from '../../src/services/video/storage/project-store';
import type {ProjectControl} from '../../src/contracts/video/project';
import type {Understanding} from '../../src/contracts/video/domain';
import {runDirectorStream} from '../../src/mastra/video/director';
import {reserveModelBudget} from '../../src/services/video/budget/model-budget';
import {withAccountedModel} from '../../src/services/video/budget/model-call';
import {recordModelRequests} from './helpers/real-probe';
async function main(){
 if(!process.argv.includes('--model'))throw Error('DIRECTOR_STREAM_OPT_IN_REQUIRED');
 const parent=resolve('.video-local/director-stream');await mkdir(parent,{recursive:true,mode:0o700});const root=await mkdtemp(join(parent,'run-')),store=new FileStore(root),projects=new ProjectStore(store);
 const {projectId}=await projects.create('probe',{schemaVersion:5,clientCommandId:randomUUID(),clientCreateId:randomUUID()}),control=(await store.readFresh<ProjectControl>('projects/'+projectId+'/control')).value,understanding=(await store.readFresh<Understanding>(control.understandingRef.key)).value;
 const r=(await reserveModelBudget(store,projectId,'director-stream',{inputTokens:60000,outputTokens:8000},{projectCalls:1,projectInputTokens:60000,projectOutputTokens:8000,dailyCalls:1})).reservation;
 const transport=recordModelRequests(process.env,root,1),start=Date.now(),fragments:{elapsedMs:number;characters:number}[]= [];let text='';
 try{
  const result=await withAccountedModel(store,r,()=>runDirectorStream(understanding,[{id:randomUUID(),role:'user',text:'请为社区图书交换日做20秒宣传视频，活动日期2026年10月8日，地点上海青禾社区。采用蜡笔绘本风格，不要旁白。回复简短，只问一个必要的问题。'}],8000,async delta=>{text+=delta;fragments.push({elapsedMs:Date.now()-start,characters:delta.length})}));
  await transport.flush();if(text!==result.reply||fragments.length<1)throw Error('DIRECTOR_STREAM_NO_REPLY');
  const budget=(await store.readFresh<{accounting:Record<string,unknown>}>('projects/'+projectId+'/budget')).value;
  const evidence={executedAt:new Date().toISOString(),status:'pass',root,projectId,model:process.env.VIDEO_DIRECTOR_MODEL,requests:transport.requests,firstDeltaMs:fragments[0].elapsedMs,totalMs:Date.now()-start,fragments,reply:result.reply,actual:budget.accounting[r.id],limits:'Real provider native structured stream; fragments forwarded during parsing, exact final text and actual usage checked. No preview/render or final quality claim.'};
  await writeFile('docs/engineering/evidence/director-stream-probe.json',JSON.stringify(evidence,null,2)+'\n');console.log(JSON.stringify({status:evidence.status,firstDeltaMs:evidence.firstDeltaMs,totalMs:evidence.totalMs,fragments:fragments.length,actual:evidence.actual}));
 }finally{await transport.flush();transport.restore()}
}
main().catch(error=>{console.error(JSON.stringify({status:'fail',errorCode:error.message}));process.exitCode=1});
