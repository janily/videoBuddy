import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {FileStore} from '../../src/services/video/storage/file-store';
import {canonicalHash} from '../../src/services/video/domain/hash';
import {auditLegacyCounter} from '../../src/services/video/budget/legacy-audit';
import {migrateLegacyValidation,type ValidationAuthorization} from '../../src/services/video/budget/validation-authorization';
import {StoreMissing} from '../../src/services/video/storage/atomic-store';
async function main(){
 if(!process.argv.includes('--migrate'))throw Error('MODEL_VALIDATION_MIGRATION_OPT_IN_REQUIRED');
 const legacy=JSON.parse(await readFile('docs/engineering/evidence/legacy-model-audit.json','utf8')),proof=JSON.parse(await readFile('docs/engineering/evidence/approved-composition-probe.json','utf8'));
 if(legacy.projectId!==proof.projectId||legacy.approvedRoot!==proof.root||!resolve(proof.root).startsWith(resolve('.video-local')+'/approved-pictures-'))throw Error('MODEL_MIGRATION_SOURCE_CHANGED');
 const source=new FileStore(legacy.root),store=new FileStore(proof.root),key='projects/'+proof.projectId+'/budget',controlKey='projects/'+proof.projectId+'/control',original=(await source.readFresh(key)).value,controlBefore=(await store.readFresh(controlKey)).value;
 const audit=auditLegacyCounter(proof.projectId,original,legacy.rows);if(audit.counterSha256!==legacy.counterSha256||canonicalHash(audit)!==canonicalHash(Object.fromEntries(Object.keys(audit).map(key=>[key,legacy[key]]))))throw Error('MODEL_MIGRATION_SOURCE_CHANGED');
 const sourceSha256=canonicalHash(await readFile('docs/engineering/model-validation-authorization.md','utf8')),authorizationPath='docs/engineering/evidence/model-validation-authorization.json';
 let authorization:ValidationAuthorization;
 try{authorization=JSON.parse(await readFile(authorizationPath,'utf8'))}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;authorization={schemaVersion:1,authorizationId:randomUUID(),authorizedAt:new Date().toISOString(),source:'user_instruction',sourceSha256,mode:'unlimited_validation'};await writeFile(authorizationPath,JSON.stringify(authorization,null,2)+'\n',{flag:'wx'})}
 if(authorization.sourceSha256!==sourceSha256)throw Error('MODEL_VALIDATION_AUTHORIZATION_CHANGED');
 // Earlier diagnostic copies retained only project JSON. Restore the exact
 // audited original daily snapshot before migration, never an empty counter.
 const importedDailyCounters:string[]=[];
 for(const day of new Set(audit.rows.map(row=>row.day))){
  const dailyKey='budgets/daily/'+day,sourceDaily=(await source.readFresh(dailyKey)).value;
  if(canonicalHash(sourceDaily)!==canonicalHash(original))throw Error('MODEL_MIGRATION_SOURCE_CHANGED');
  try{await store.readFresh(dailyKey)}catch(error){if(!(error instanceof StoreMissing))throw error;
   if(canonicalHash((await store.readFresh(key)).value)!==canonicalHash(original))throw Error('MODEL_MIGRATION_SOURCE_CHANGED');
   try{await store.readFresh('budgets/model-gate');throw Error('MODEL_MIGRATION_SOURCE_CHANGED')}catch(error){if(!(error instanceof StoreMissing))throw error}
   await store.create(dailyKey,sourceDaily);importedDailyCounters.push(dailyKey);
  }
 }
 const receipt=await migrateLegacyValidation(store,[{projectId:proof.projectId,counter:original,rows:audit.rows}],authorization),counter=(await store.readFresh(key)).value;
 if(canonicalHash((await source.readFresh(key)).value)!==canonicalHash(original)||canonicalHash((await store.readFresh(controlKey)).value)!==canonicalHash(controlBefore))throw Error('MODEL_MIGRATION_SOURCE_CHANGED');
 const report={executedAt:new Date().toISOString(),status:'pass',root:proof.root,projectId:proof.projectId,authorization,receipt,sourceBudgetUnchanged:true,approvedControlUnchanged:true,importedDailyCounters,originalCounter:original,migratedCounter:counter,rawResponses:audit.rawResponses,reportedOnlyResponses:audit.reportedOnlyResponses,additionalModelCalls:0,limits:'Explicit stopped-worker diagnostic-scope migration under the user unlimited future validation authorization. Seven historical reservations retained, conservative positive overruns added, original snapshot and provenance persisted. The diagnostic copy lacked daily JSON: imported the exact audited original daily counter, not empty capacity. Report-only usages remain historical, not provider-verified billing. No paid attempt, production enablement or quality publication.'};
 await writeFile('docs/engineering/evidence/model-validation-migration.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,additionalModelCalls:0,receipt,counterCalls:(counter as {calls:number}).calls,rawResponses:audit.rawResponses,reportedOnlyResponses:audit.reportedOnlyResponses}));
}
main().catch(error=>{console.error(JSON.stringify({status:'fail',errorCode:String(error?.message||'MODEL_MIGRATION_FAILED').slice(0,200)}));process.exitCode=1});
