import {readFile,writeFile} from 'node:fs/promises';
import {FileStore} from '../../src/services/video/storage/file-store';
import {ProjectStore} from '../../src/services/video/storage/project-store';
import {canonicalHash} from '../../src/services/video/domain/hash';
import type {ProjectControl} from '../../src/contracts/video/project';
import type {Environment} from '../../src/services/video/config/environment';
import {reviewApprovedWholeFilm} from '../../src/services/video/render/visual-review';
import {requireUnlimitedValidation} from '../../src/services/video/budget/validation-authorization';
import {probeEnvironment,recordModelRequests} from './helpers/real-probe';
async function main(){
 if(!process.argv.includes('--review'))throw Error('APPROVED_WHOLE_CRITIC_OPT_IN_REQUIRED');
 if(!process.env.MODEL_API_KEY||!process.env.MODEL_BASE_URL)throw Error('MODEL_CREDENTIALS_REQUIRED');
 const proof=JSON.parse(await readFile('docs/engineering/evidence/approved-composition-probe.json','utf8')),evidence=JSON.parse(await readFile('docs/engineering/evidence/approved-visual-evidence-probe.json','utf8'));
 if(proof.root!==evidence.root||proof.projectId!==evidence.projectId||proof.operationId!==evidence.operationId)throw Error('CRITIC_BASELINE_CHANGED');
 const store=new FileStore(proof.root),projects=new ProjectStore(store),key='projects/'+proof.projectId+'/control',before=(await store.readFresh<ProjectControl>(key)).value,authorization=await requireUnlimitedValidation(store);
 const env:Environment={...probeEnvironment(proof.root),VIDEO_MODEL_BUDGET_MODE:'unlimited_validation'},transport=recordModelRequests(env,proof.root,evidence.record.batches.length);
 let result:Awaited<ReturnType<typeof reviewApprovedWholeFilm>>|undefined,errorCode:string|undefined;
 const progress=setInterval(()=>console.log(JSON.stringify({stage:'whole_visual_critic',providerCallsStarted:transport.requests.length,plannedBatches:evidence.record.batches.length})),30000);
 try{result=await reviewApprovedWholeFilm(projects,before.ownerKeyHash,proof.projectId,proof.operationId,0,{root:proof.root,env})}catch(error){errorCode=String((error as Error).message).replaceAll(env.MODEL_API_KEY||'missing-key','[redacted]').slice(0,200)}finally{clearInterval(progress);try{await transport.flush()}finally{transport.restore()}}
 const after=(await store.readFresh<ProjectControl>(key)).value,budget=(await store.readFresh('projects/'+proof.projectId+'/budget')).value,gate=(await store.readFresh('budgets/model-gate')).value;
 if(canonicalHash(before)!==canonicalHash(after))throw Error('CRITIC_CONTROL_CHANGED');
 const report={executedAt:new Date().toISOString(),status:errorCode?'blocked':result?.report.result==='pass'?'pass':'quality_failed',root:proof.root,projectId:proof.projectId,operationId:proof.operationId,authorizationId:authorization.authorizationId,requests:transport.requests,budget,gate,result:result??null,...(errorCode?{errorCode}:{}),controlUnchanged:true,resultPublished:false,visualQualityPassed:result?.report.result==='pass',limits:'Actual native Mastra multimodal review of the frozen approved 1080p film and two whole-film sampled-frame rounds, using real PNG bytes. Unlimited future validation explicitly authorized; each call has durable usage/effect records, no automatic retry, all historical reservations preserved. Sampled judgments do not prove continuous motion/listening/licenses or full delivery eligibility. Historical failures remain recorded; no production deployment.'};
 await writeFile('docs/engineering/evidence/approved-whole-critic-probe.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,requests:transport.requests.length,result:result?.report??null,errorCode,controlUnchanged:true,resultPublished:false}));
 if(errorCode)process.exitCode=1;
}
main().catch(error=>{console.error(JSON.stringify({status:'fail',errorCode:String(error?.message||'APPROVED_WHOLE_CRITIC_FAILED').replaceAll(process.env.MODEL_API_KEY||'missing-key','[redacted]').slice(0,200)}));process.exitCode=1});
