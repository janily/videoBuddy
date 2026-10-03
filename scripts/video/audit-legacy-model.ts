import {constants} from 'node:fs';
import {open,realpath,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {z} from 'zod';
import {canonicalHash} from '../../src/services/video/domain/hash';
import {auditLegacyCounter,recoverReservationCost,type LegacyAuditRow} from '../../src/services/video/budget/legacy-audit';
const digest=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex');
async function readJson(path:string){
 if(await realpath(path)!==path)throw Error('LEGACY_AUDIT_INVALID');const file=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);
 try{const info=await file.stat();if(!info.isFile()||info.nlink!==1||info.size>2*1024*1024)throw Error('LEGACY_AUDIT_INVALID');const bytes=await file.readFile();return{value:JSON.parse(bytes.toString()),sha256:digest(bytes)}}finally{await file.close()}
}
async function main(){
 if(!process.argv.includes('--inspect'))throw Error('LEGACY_AUDIT_OPT_IN_REQUIRED');
 const directory=resolve('docs/engineering/evidence'),creation=await readJson(join(directory,'real-creation-no-voice-probe.json')),visual=await readJson(join(directory,'real-visual-probe.json')),audio=await readJson(join(directory,'real-audio-repair-probe.json')),approved=await readJson(join(directory,'approved-composition-probe.json'));
 const root=await realpath(creation.value.root),allowed=await realpath(resolve('.video-local/real-creation'));
 if(!root.startsWith(allowed+'/')||root!==visual.value.root||root!==audio.value.root)throw Error('LEGACY_AUDIT_INVALID');
 const {projectId,revisionId,operationId}=z.object({projectId:z.uuid(),revisionId:z.uuid(),operationId:z.uuid()}).parse(creation.value.stages.project),projectKey=`projects/${projectId}/budget.json`,budget=await readJson(join(root,projectKey)),control=await readJson(join(root,`projects/${projectId}/control.json`));
 if(budget.value.calls!==7||creation.value.requests.length!==2||visual.value.requests.length!==4||audio.value.requests.length!==1||visual.value.projectId!==projectId||visual.value.revisionId!==revisionId||audio.value.projectId!==projectId||audio.value.revisionId!==revisionId)throw Error('LEGACY_AUDIT_INVALID');
 const rows:LegacyAuditRow[]=[],files:{path:string;sha256:string}[]=[],costs=new Map<string,{inputTokens:number;outputTokens:number}>();
 async function append(stage:string,request:Record<string,unknown>){
  const id=canonicalHash({projectId,stage}),hash=budget.value.reservations[id];if(!hash||request.status!==200||request.model!=='gemini-3.8-flash')throw Error('LEGACY_AUDIT_INVALID');
  const intent=await readJson(join(root,`projects/${projectId}/budget-intents/${id}.json`));if(intent.value.hash!==hash)throw Error('LEGACY_AUDIT_INVALID');
  const cap=z.number().int().positive().max(50000).parse(request.maxTokens);let cost=costs.get(hash);if(!cost){cost=recoverReservationCost(hash,cap,budget.value.inputTokens);costs.set(hash,cost)}if(cost.outputTokens!==cap)throw Error('LEGACY_AUDIT_INVALID');
  let evidence:LegacyAuditRow['evidence']='historical_report',responseSha256: string|undefined;
  if(request.responseFile!==undefined){
   if(typeof request.responseFile!=='string'||!/^model-diagnostics\/[a-f0-9]{64}\.json$/.test(request.responseFile))throw Error('LEGACY_AUDIT_INVALID');
   const response=await readJson(join(root,request.responseFile));if(response.sha256!==request.responseSha256||response.sha256!==request.responseFile.slice(18,-5)||canonicalHash(response.value.usage)!==canonicalHash(request.usage)||response.value.model!==request.model)throw Error('LEGACY_AUDIT_INVALID');
   evidence='raw_response';responseSha256=response.sha256;files.push({path:request.responseFile,sha256:response.sha256});
  }
  const usage=z.object({prompt_tokens:z.number().int().nonnegative(),completion_tokens:z.number().int().nonnegative(),total_tokens:z.number().int().nonnegative()}).parse(request.usage);if(usage.total_tokens!==usage.prompt_tokens+usage.completion_tokens)throw Error('LEGACY_AUDIT_INVALID');
  rows.push({id,stage,cost,day:intent.value.day,usage:{inputTokens:usage.prompt_tokens,outputTokens:usage.completion_tokens},evidence,...(responseSha256?{responseSha256}:{})});
 }
 await append(`${operationId}-treatment-${revisionId}`,creation.value.requests[0]);await append(`${operationId}-audio-${revisionId}`,creation.value.requests[1]);
 const shots=Object.keys(visual.value.shots);if(shots.length!==4)throw Error('LEGACY_AUDIT_INVALID');
 for(let index=0;index<shots.length;index++)await append(`${operationId}-visual-${revisionId}-${canonicalHash({shotId:shots[index]})}`,visual.value.requests[index]);
 const repairOperationId=z.uuid().parse(audio.value.operationId);await append(`${repairOperationId}-audio-${revisionId}`,audio.value.requests[0]);
 const audit=auditLegacyCounter(projectId,budget.value,rows),days=[...new Set(rows.map(row=>row.day))];if(days.length!==1)throw Error('LEGACY_AUDIT_INVALID');
 const dailyKey=`budgets/daily/${days[0]}.json`,daily=await readJson(join(root,dailyKey));if(canonicalHash(daily.value)!==canonicalHash(budget.value))throw Error('LEGACY_AUDIT_INVALID');
 const approvedRoot=await realpath(approved.value.root),copied=await readJson(join(approvedRoot,projectKey));if(canonicalHash(copied.value)!==canonicalHash(budget.value))throw Error('LEGACY_AUDIT_INVALID');
 if((await readJson(join(root,projectKey))).sha256!==budget.sha256||(await readJson(join(root,dailyKey))).sha256!==daily.sha256||(await readJson(join(root,`projects/${projectId}/control.json`))).sha256!==control.sha256||(await readJson(join(approvedRoot,projectKey))).sha256!==copied.sha256)throw Error('LEGACY_AUDIT_SNAPSHOT_CHANGED');
 const report={executedAt:new Date().toISOString(),status:'blocked',projectId,root,approvedRoot,...audit,sourceProjectAndDailyCountersMatch:true,approvedCounterMatchesSource:true,projectBudgetUnchanged:true,dailyBudgetUnchanged:true,sourceControlUnchanged:true,approvedBudgetUnchanged:true,additionalModelCalls:0,evidenceReports:[{path:'real-creation-no-voice-probe.json',sha256:creation.sha256},{path:'real-visual-probe.json',sha256:visual.sha256},{path:'real-audio-repair-probe.json',sha256:audio.sha256}],rawResponseFiles:files,limits:'Read-only retrospective project audit. Five raw provider response bodies verified; two initial usages are historical recorder reports only, without raw bodies. Stage association comes from historical probe reports, not a signed provider billing attestation. No accounting migration, refund, quota change, new gate, operator approval or generation. Known overruns remain blocking.'};
 await writeFile(join(directory,'legacy-model-audit.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,reservedCalls:audit.reservedCalls,rawResponses:audit.rawResponses,reportedOnlyResponses:audit.reportedOnlyResponses,actualUsage:audit.actualUsage,conservativeAfterAccounting:audit.conservativeAfterAccounting,overrunCalls:audit.overrunCalls,overrunOutputTokens:audit.overrunOutputTokens,blockers:audit.blockers,migrationReady:false,additionalModelCalls:0}));
}
main().catch(error=>{console.error(JSON.stringify({status:'fail',errorCode:String(error?.message||'LEGACY_AUDIT_FAILED').slice(0,120)}));process.exitCode=1});
