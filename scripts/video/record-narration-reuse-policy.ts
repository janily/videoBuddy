import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {FileStore} from '../../src/services/video/storage/file-store';
import {ProjectStore} from '../../src/services/video/storage/project-store';
import {canonicalHash} from '../../src/services/video/domain/hash';
import {createOrRead,updateJson} from '../../src/services/video/storage/atomic-store';
import type {ProjectControl} from '../../src/contracts/video/project';
import {recordUserCommandActivity} from '../../src/services/video/commands/user-activity';
import {validateNarrationPolicySource,confirmNarrationReusePolicy} from '../../src/services/video/audio/narration-policy';
import {verifyPostMixNarration} from '../../src/services/video/audio/postmix-asr';
import {resolvePreviewPostMixReview} from '../../src/services/video/preview/postmix-review';
import {claimProbeReport,persistProbeReport} from './helpers/probe-report';
async function main(){
 if(process.argv.slice(2).join(' ')!=='--record-explicit-same-source-audio-policy')throw Error('NARRATION_POLICY_USER_REPLY_REQUIRED');
 const source=JSON.parse(await readFile('docs/engineering/evidence/book-preview-postmix-probe.json','utf8')),answer=JSON.parse(await readFile('docs/engineering/evidence/new-theme-book-postmix-spoken-review-confirmation.json','utf8'));
 if(source.status!=='exact_new_book_mix_mismatch_ready_for_listening'||answer.authority!=='actual_workspace_user_reply'||answer.questionItemId!=='["request_user_input_async","call_eBDDyhrtoiQTmR63WXgtR6XE",0]'||answer.answer!=='读音正确，音频这快就全部通过，不需要每一个影片都来验证'||answer.formalProductionApproval!==false||answer.preference.reuseTrustedPronunciationForSameSource!==true||answer.preference.repeatListeningRequestForEveryFilm!==false||answer.projectId!==source.projectId||answer.sourceRevisionId!==source.sourceRevisionId||answer.filmSha256!==source.context.film.sha256||answer.planSha256!==canonicalHash(source.context.plan))throw Error('NARRATION_POLICY_USER_REPLY_CHANGED');
 const {root,projectId,sourceRevisionId}=source,owner='new-theme-validation',store=new FileStore(root),projects=new ProjectStore(store),before=await projects.access(owner,projectId),prefix=`projects/${projectId}/`,journal={store,prefix:prefix+`operations/${source.sourceOperationId}/media-effects`};
 const original=JSON.parse(await readFile('docs/engineering/evidence/new-theme-book-caption-preview-v2-probe.json','utf8')),voice=original.stages.stageRecords['voice-stage'];
 if(original.root!==root||original.projectId!==projectId||original.stages.operation.id!==source.sourceOperationId||original.stages.operation.revisionId!==sourceRevisionId||canonicalHash(voice)!==canonicalHash((await store.readFresh(prefix+`revisions/${sourceRevisionId}/voice-stage`)).value)||canonicalHash(voice.planRef)!==canonicalHash(source.planRef)||canonicalHash(voice.verifiedRef)!==canonicalHash(source.verifiedRef))throw Error('NARRATION_POLICY_SOURCE_CHANGED');
 const {plan,verified}=await validateNarrationPolicySource(projects,root,projectId,sourceRevisionId,source.planRef,source.verifiedRef);
 if(canonicalHash(plan)!==canonicalHash(source.context.plan))throw Error('NARRATION_POLICY_SOURCE_CHANGED');
 const keys=[prefix+'budget',prefix+'operations/'+source.sourceOperationId],beforeHashes=await Promise.all(keys.map(async k=>canonicalHash((await store.readFresh(k)).value))),beforeNative=await store.listKeys(journal.prefix,1),path='docs/engineering/evidence/narration-reuse-policy-probe.json';
 const report:Record<string,unknown>={executedAt:new Date().toISOString(),status:'started',root,projectId,sourceOperationId:source.sourceOperationId,sourceRevisionId,filmSha256:source.context.film.sha256,sourceReplyQuestionItemId:answer.questionItemId,newModelCalls:0,formalProductionApproval:false,deliveryEligible:false};await claimProbeReport(path,report);
 try{
  const intent=await createOrRead(store,prefix+'workspace-narration-policy/'+canonicalHash({answer,planRef:source.planRef,verifiedRef:source.verifiedRef}),{messageId:randomUUID()});
  const messages=await projects.messages(before);if(!messages.some(m=>m.id===intent.messageId)){
   const ordinal=Math.max(before.nextOrdinal,...messages.map(m=>m.ordinal+1));await updateJson(store,prefix+'control',(c:ProjectControl)=>({...c,controlVersion:c.controlVersion+1,nextOrdinal:Math.max(c.nextOrdinal,ordinal+1)}));
   await projects.archiveMessage(projectId,{id:intent.messageId,ordinal,role:'user',text:answer.answer,status:'completed',contentVersion:1,clientMessageId:intent.messageId,narrationPolicyAction:{scope:'same_verified_narration',planSha256:source.planRef.sha256,verifiedSha256:source.verifiedRef.sha256,decision:'reuse_pronunciation_without_repeated_listening'}});
  }
  await recordUserCommandActivity(projects,owner,projectId,intent.messageId,canonicalHash({kind:'narration_reuse_policy',questionItemId:answer.questionItemId,planRef:source.planRef,verifiedRef:source.verifiedRef}));
  report.policyRef=await confirmNarrationReusePolicy(projects,root,owner,projectId,sourceRevisionId,source.planRef,source.verifiedRef,intent.messageId);report.sourceMessageId=intent.messageId;await persistProbeReport(path,report);
  const context=source.context,env={VIDEO_MEDIA_IMAGE_REF:'sha256:'+context.window.mediaRuntimeDigest,VIDEO_MEDIA_RUNTIME_DIGEST:context.window.mediaRuntimeDigest,VIDEO_MEDIA_TIMEOUT_SECONDS:'600',VIDEO_ASR_IMAGE_REF:'sha256:'+context.transcript.runtimeDigest,VIDEO_ASR_RUNTIME_DIGEST:context.transcript.runtimeDigest,VIDEO_ASR_MODEL:context.transcript.model};
  const assertActive=async()=>{const c=await projects.access(owner,projectId);if(c.consentEpoch!==before.consentEpoch||c.briefVersion!==before.briefVersion||canonicalHash(c.understandingRef)!==canonicalHash(before.understandingRef)||c.activeProduction!==before.activeProduction)throw Error('NARRATION_POLICY_STALE')};
  const options={mustExist:true,journal,assertActive,resolveReview:(value:typeof context)=>resolvePreviewPostMixReview(projects,root,projectId,sourceRevisionId,value,{mustExist:true,verified})};
  const result=await verifyPostMixNarration(root,context.film,plan,verified,env,undefined,options);report.result=result;await persistProbeReport(path,report);
  const cold=await verifyPostMixNarration(root,context.film,plan,verified,env,undefined,options);if(canonicalHash(cold)!==canonicalHash(result))throw Error('NARRATION_POLICY_COLD_CHANGED');
  if(canonicalHash(beforeNative)!==canonicalHash(await store.listKeys(journal.prefix,1))||canonicalHash(beforeHashes)!==canonicalHash(await Promise.all(keys.map(async k=>canonicalHash((await store.readFresh(k)).value)))))throw Error('NARRATION_POLICY_SOURCE_CHANGED');
  const after=await projects.access(owner,projectId);if(after.phase!==before.phase||after.currentPreviewId!==before.currentPreviewId)throw Error('NARRATION_POLICY_SOURCE_CHANGED');
  report.coldMatches=true;report.newNativeCalls=0;report.originalOperationAndBudgetUnchanged=true;report.standingRuntimePolicyImplemented=true;report.status='same_source_audio_verified_without_repeated_listening';
 }catch(error){report.status='failed';report.errorCode=String((error as Error).message).slice(0,300);process.exitCode=1}
 finally{await persistProbeReport(path,report);console.log(JSON.stringify({status:report.status,errorCode:report.errorCode,newModelCalls:0,newNativeCalls:report.newNativeCalls}))}
}
main().catch(error=>{console.error(error.message);process.exitCode=1});
