import {mkdir,mkdtemp,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {initialUnderstanding} from '../../src/contracts/video/domain';
import {runDirector} from '../../src/mastra/video/director';
import {directorContext} from '../../src/mastra/video/director';
import {FileStore} from '../../src/services/video/storage/file-store';
import {reserveModelBudget} from '../../src/services/video/budget/model-budget';
import {withAccountedModel} from '../../src/services/video/budget/model-call';
import {recordModelRequests} from './helpers/real-probe';
async function main(){
 if(!process.argv.includes('--accounting'))throw Error('MODEL_ACCOUNTING_PROBE_OPT_IN_REQUIRED');
 if(!process.env.MODEL_API_KEY||!process.env.MODEL_BASE_URL)throw Error('MODEL_ACCOUNTING_CREDENTIALS_REQUIRED');
 const parent=resolve('.video-local/model-accounting');await mkdir(parent,{recursive:true,mode:0o700});const root=await mkdtemp(join(parent,'run-'));
 const env=process.env,store=new FileStore(root),projectId=randomUUID(),stage=randomUUID(),understanding=initialUnderstanding();
 const messages=[{id:randomUUID(),role:'user' as const,text:'我想做一支20秒的社区旧书交换活动预告，2026年10月8日在上海青禾社区广场举行，请先帮我理清想法，不要开始制作。'}];
 const cost={inputTokens:Buffer.byteLength(JSON.stringify(directorContext(understanding,messages)))+4096,outputTokens:4000},limits={projectCalls:1,projectInputTokens:100000,projectOutputTokens:4000,dailyCalls:1};
 const r=(await reserveModelBudget(store,projectId,stage,cost,limits)).reservation,transport=recordModelRequests(env,root,1);
 let decision,errorCode;
 try{
  decision=await withAccountedModel(store,r,()=>runDirector(understanding,messages,cost.outputTokens));
 }catch(error){errorCode=String((error as Error).message).replaceAll(env.MODEL_API_KEY!,'[redacted]').slice(0,200)}
 finally{await transport.flush();transport.restore()}
 const budget=(await store.readFresh<{calls:number;inputTokens:number;outputTokens:number;accounting?:Record<string,{state:string;inputTokens?:number;outputTokens?:number}>}>('projects/'+projectId+'/budget')).value;
 const actual=budget.accounting?.[r.id];
 const gate=(await store.readFresh('budgets/model-gate')).value;
 if(transport.requests.length!==1||!actual)throw Error('MODEL_ACCOUNTING_PROBE_NO_ACTUAL_CALL');
 let nextCallRejected=false;try{await reserveModelBudget(new FileStore(root),projectId,randomUUID(),{inputTokens:1,outputTokens:1},limits)}catch{nextCallRejected=true}
 const evidence={executedAt:new Date().toISOString(),root,projectId,reservationId:r.id,providerOrigin:new URL(env.MODEL_BASE_URL!).origin,model:env.VIDEO_DIRECTOR_MODEL,reserved:cost,requests:transport.requests,actual,gate,budget:{calls:budget.calls,inputTokens:budget.inputTokens,outputTokens:budget.outputTokens},status:decision?'pass':'blocked',...(errorCode?{errorCode}:{}),semanticStatus:decision?'validated':'not_passed',nextCallRejected,additionalModelCalls:0,limits:'Explicit one-call paid native Mastra Director experiment in a new isolated technical experiment root, with zero retry, HTTP deadline and actual SDK usage ledger. Provider has empirically ignored token caps; no hard fee guarantee. Persistent deployment gate spans UTC midnight. Unknown/overrun freeze or configured call-limit denial is preserved, no refund/retry or production activation. Historical counters require audit, not automatic reset. Diagnostic response only in ignored private root.'};
 await writeFile('docs/engineering/evidence/model-accounting-probe.json',JSON.stringify(evidence,null,2)+'\n');
 console.log(JSON.stringify({status:evidence.status,actual:evidence.actual,reserved:cost,nextCallRejected,requests:transport.requests.length,...(errorCode?{errorCode}:{})}));
}
main().catch(error=>{console.error(JSON.stringify({status:'fail',errorCode:String(error?.message||'MODEL_ACCOUNTING_PROBE_FAILED').replaceAll(process.env.MODEL_API_KEY||'missing-key','[redacted]').slice(0,200)}));process.exitCode=1});
