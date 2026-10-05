import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {FileStore} from '../../src/services/video/storage/file-store';
import {ProjectStore} from '../../src/services/video/storage/project-store';
import {canonicalHash} from '../../src/services/video/domain/hash';
import {readPublishedPreview} from '../../src/services/video/preview/commit';
import {loadPostMixVerification} from '../../src/services/video/audio/postmix-verification';
import {prepareFrozenSourceArchive} from '../../src/services/video/exports/source-archive';
import {readNarrationJson} from '../../src/services/video/audio/narration-package';
import {persistProbeArchive} from './helpers/probe-archive';
import {claimProbeReport,persistProbeReport} from './helpers/probe-report';
async function main(){
 const version3=process.argv.slice(2).join(' ')==='--verify-published-clear-preview-v3',version2=process.argv.slice(2).join(' ')==='--verify-published-clear-preview-v2';
 if(!version3&&!version2&&process.argv.slice(2).join(' ')!=='--verify-published-clear-preview')throw Error('CLEAR_PUBLISHED_PREVIEW_FLAG_REQUIRED');
 const source=JSON.parse(await readFile('docs/engineering/evidence/clear-frozen-preview-continuation-probe.json','utf8')),group=JSON.parse(await readFile('docs/engineering/evidence/completed-clear-postmix-verification-probe.json','utf8'));
 if(source.status!=='preview_published'||source.operation.status!=='succeeded'||source.requests.length!==1||source.requests[0].status!==200)throw Error('CLEAR_PUBLISHED_PREVIEW_REQUIRED');
 const {root,projectId,operation}=source,store=new FileStore(root),projects=new ProjectStore(store),prefix=`projects/${projectId}/`,keys=[prefix+'control',prefix+'budget',prefix+'operations/'+operation.id,prefix+'operations/'+source.sourceOperationId],before=await Promise.all(keys.map(async key=>canonicalHash((await store.readFresh(key)).value))),path=version3?'docs/engineering/evidence/clear-published-preview-validation-v3-probe.json':version2?'docs/engineering/evidence/clear-published-preview-validation-v2-probe.json':'docs/engineering/evidence/clear-published-preview-validation-probe.json',report:Record<string,unknown>={executedAt:new Date().toISOString(),status:'started',root,projectId,operationId:operation.id,newModelCalls:0,newNativeCalls:0,formalProductionApproval:false,deliveryEligible:false};await claimProbeReport(path,report);
 try{
  const bundle=await readPublishedPreview(new ProjectStore(new FileStore(root)),projectId,operation.id,operation.consentEpoch,operation.previewId,root);report.bundle=bundle;
  const proof=await loadPostMixVerification(projects,root,projectId,group.verificationRef,group.frozenInput);report.completedVerificationMatches=canonicalHash(proof)===canonicalHash(group.verification);
  const reviews=[];for(const key of await store.listKeys(prefix+'revisions/'+operation.revisionId+'/visual-review-batches',1)){const batch=(await store.readFresh<{reviewRef:Parameters<typeof readNarrationJson>[1];contextRef:Parameters<typeof readNarrationJson>[1]}>(key)).value;reviews.push({key,batch,review:await readNarrationJson(store,batch.reviewRef,prefix+'revisions/'+operation.revisionId+'/visual-review/'),context:await readNarrationJson(store,batch.contextRef,prefix+'revisions/'+operation.revisionId+'/visual-review-context/')})}report.reviews=reviews;
  const request=source.requests[0],raw=await readFile(join(root,request.responseFile));if(createHash('sha256').update(raw).digest('hex')!==request.responseSha256)throw Error('CLEAR_RESPONSE_CHANGED');const response=JSON.parse(raw.toString('utf8'));if(canonicalHash(response.usage)!==canonicalHash(request.usage))throw Error('CLEAR_USAGE_CHANGED');
  const effectKeys=await store.listKeys(prefix+'operations/'+operation.id+'/effects/visual-critic',1);if(effectKeys.length!==1)throw Error('CLEAR_ACCOUNTING_CHANGED');const reservationId=canonicalHash({projectId,stage:operation.id+'-critic-'+effectKeys[0].split('/').at(-1)}),budget=(await store.readFresh<{accounting:Record<string,{state:string;inputTokens:number;outputTokens:number}>}>(prefix+'budget')).value,entry=budget.accounting[reservationId];if(!entry||entry.state!=='settled'||entry.inputTokens!==request.usage.prompt_tokens||entry.outputTokens!==request.usage.completion_tokens)throw Error('CLEAR_ACCOUNTING_CHANGED');const settled=[[reservationId,entry]];report.modelAudit={responseSha256:request.responseSha256,responseBytes:raw.length,rawUsage:request.usage,accounting:settled};
  const archive=await prepareFrozenSourceArchive(projects,'new-theme-validation',projectId,operation.previewId,root);report.archive={...archive,bytes:undefined};
  const zipPath=await persistProbeArchive(root,archive.bytes);report.sourceZipPath=zipPath;report.sourceZipSha256=createHash('sha256').update(archive.bytes).digest('hex');report.sourceZipBytes=archive.bytes.length;
  report.status='published_preview_cold_accounted_source_zip_verified';
 }catch(error){report.status='failed';report.errorCode=(error as Error).message;process.exitCode=1}
 finally{report.sourceControlBudgetOperationsUnchanged=canonicalHash(before)===canonicalHash(await Promise.all(keys.map(async key=>canonicalHash((await store.readFresh(key)).value))));if(!report.sourceControlBudgetOperationsUnchanged){report.status='failed';report.errorCode='CLEAR_PUBLISHED_SOURCE_CHANGED';process.exitCode=1}await persistProbeReport(path,report);console.log(JSON.stringify({status:report.status,errorCode:report.errorCode,sourceZipBytes:report.sourceZipBytes}));}
}
main().catch(error=>{console.error(error.message);process.exitCode=1});
