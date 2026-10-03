import {readFile,writeFile,mkdtemp} from 'node:fs/promises';
import {resolve} from 'node:path';
import {FileStore} from '../../src/services/video/storage/file-store';
import {canonicalHash} from '../../src/services/video/domain/hash';
import {reserveModelBudget} from '../../src/services/video/budget/model-budget';
async function main(){
 if(!process.argv.includes('--inspect'))throw Error('VISUAL_BUDGET_INSPECTION_OPT_IN_REQUIRED');
 const proof=JSON.parse(await readFile('docs/engineering/evidence/approved-visual-evidence-probe.json','utf8')),original=new FileStore(proof.root),key=`projects/${proof.projectId}/budget`,before=(await original.readFresh<Record<string,unknown>>(key)).value;
 if(before.calls!==7||before.accountingVersion!==undefined)throw Error('LEGACY_SNAPSHOT_CHANGED');
 // Copy the historical occupied counter, not an empty replacement. The
 // original project and budget are never migrated or reset by this probe.
 const root=await mkdtemp(resolve('.video-local/visual-budget-inspection-')),isolated=new FileStore(root);await isolated.create(key,before);
 let errorCode='';try{await reserveModelBudget(isolated,proof.projectId,'formal-visual-preflight',{inputTokens:1,outputTokens:1},{projectCalls:100,projectInputTokens:1000000,projectOutputTokens:1000000,dailyCalls:100})}catch(error){errorCode=error instanceof Error?error.message:'UNKNOWN'}
 if(errorCode!=='MODEL_ACCOUNTING_MIGRATION_REQUIRED'||canonicalHash((await original.readFresh(key)).value)!==canonicalHash(before)||canonicalHash((await isolated.readFresh(key)).value)!==canonicalHash(before))throw Error('LEGACY_GUARD_NOT_CONFIRMED');
 const result={executedAt:new Date().toISOString(),status:'blocked',expectedGuardConfirmed:true,projectId:proof.projectId,sourceRoot:proof.root,diagnosticRoot:root,historicalProjectCalls:7,accountingVersion:null,budgetSha256:canonicalHash(before),errorCode,originalBudgetUnchanged:true,copiedCounterUnchanged:true,additionalModelCalls:0,limits:'Isolated exact occupied legacy-counter copy demonstrates the actual budget migration guard. No generation, provider request, audit approval, migration, refund or counter reset. This is a billing preflight blocker, not a visual-quality pass.'};
 await writeFile('docs/engineering/evidence/approved-visual-budget-probe.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
}
main().catch(error=>{console.error(JSON.stringify({status:'fail',errorCode:error.message}));process.exitCode=1});
