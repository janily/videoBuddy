import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {FileStore} from '../../src/services/video/storage/file-store';
import {ProjectStore} from '../../src/services/video/storage/project-store';
import {canonicalHash} from '../../src/services/video/domain/hash';
import {readNarrationJson} from '../../src/services/video/audio/narration-package';
import {createOrRead,updateJson} from '../../src/services/video/storage/atomic-store';
import type {ProjectControl} from '../../src/contracts/video/project';
import {recordUserCommandActivity} from '../../src/services/video/commands/user-activity';
import {assertPostMixReviewChallenge,confirmPostMixReview,loadConfirmedPostMixReview,findConfirmedPostMixReview,verifyReviewedPostMixText,type PostMixReviewContext} from '../../src/services/video/audio/postmix-review';
import {verifyPostMixNarration} from '../../src/services/video/audio/postmix-asr';
import type {VerifiedNarrationManifest} from '../../src/services/video/audio/asr';
import {claimProbeReport,persistProbeReport} from './helpers/probe-report';
async function main(){
 if(process.argv.slice(2).join(' ')!=='--record-explicit-book-mix-user-reply')throw Error('BOOK_MIX_REPLY_REQUIRED');
 const source=JSON.parse(await readFile('docs/engineering/evidence/book-preview-postmix-probe.json','utf8')),answer=JSON.parse(await readFile('docs/engineering/evidence/new-theme-book-postmix-spoken-review-confirmation.json','utf8')),context:PostMixReviewContext=source.context;
 if(source.status!=='exact_new_book_mix_mismatch_ready_for_listening'||answer.authority!=='actual_workspace_user_reply'||answer.questionItemId!=='["request_user_input_async","call_eBDDyhrtoiQTmR63WXgtR6XE",0]'||answer.answer!=='读音正确，音频这快就全部通过，不需要每一个影片都来验证'||answer.decision!=='pronunciation_correct'||answer.filmSha256!==context.film.sha256||answer.mixedWavSha256!==context.transcript.voiceSha256||answer.transcriptSha256!==canonicalHash(context.transcript)||answer.formalProductionApproval!==false)throw Error('BOOK_MIX_REPLY_CHANGED');
 const {root,projectId}=source,owner='new-theme-validation',store=new FileStore(root),projects=new ProjectStore(store),prefix=`projects/${projectId}/`,before=await projects.access(owner,projectId),sourceKeys=[prefix+'budget',prefix+'operations/'+source.sourceOperationId],hashes=await Promise.all(sourceKeys.map(async key=>canonicalHash((await store.readFresh(key)).value))),journal={store,prefix:prefix+`operations/${source.sourceOperationId}/media-effects`},beforeKeys=await store.listKeys(journal.prefix,1),path='docs/engineering/evidence/book-preview-postmix-reviewed-probe.json',report:Record<string,unknown>={executedAt:new Date().toISOString(),status:'started',root,projectId,sourceOperationId:source.sourceOperationId,sourceRevisionId:source.sourceRevisionId,film:context.film,newModelCalls:0,formalProductionApproval:false,deliveryEligible:false};await claimProbeReport(path,report);
 try{
  const revisionPrefix=prefix+`revisions/${source.sourceRevisionId}/`,plan=await readNarrationJson(store,source.planRef,revisionPrefix+'voice-plan/'),verified=await readNarrationJson(store,source.verifiedRef,revisionPrefix+'voice-verified/') as VerifiedNarrationManifest;
  if(canonicalHash(plan)!==canonicalHash(context.plan))throw Error('BOOK_MIX_SOURCE_CHANGED');
  const original=JSON.parse(await readFile('docs/engineering/evidence/new-theme-book-caption-preview-v2-probe.json','utf8')),voice=original.stages.stageRecords['voice-stage'];
  if(original.root!==root||original.projectId!==projectId||original.stages.operation.id!==source.sourceOperationId||original.stages.operation.revisionId!==source.sourceRevisionId||canonicalHash(voice)!==canonicalHash((await store.readFresh(revisionPrefix+'voice-stage')).value)||canonicalHash(voice.planRef)!==canonicalHash(source.planRef)||canonicalHash(voice.verifiedRef)!==canonicalHash(source.verifiedRef))throw Error('BOOK_MIX_SOURCE_CHANGED');
  await assertPostMixReviewChallenge(store,projectId,source.challengeRef,source.sourceRevisionId,context);
  const intent=await createOrRead(store,prefix+'workspace-postmix-confirmations/'+canonicalHash(answer),{messageId:randomUUID(),challengeRef:source.challengeRef});if(canonicalHash(intent.challengeRef)!==canonicalHash(source.challengeRef))throw Error('BOOK_MIX_REPLY_CHANGED');
  const messages=await projects.messages(before);if(!messages.some(m=>m.id===intent.messageId)){
   const ordinal=Math.max(before.nextOrdinal,...messages.map(m=>m.ordinal+1));await updateJson(store,prefix+'control',(c:ProjectControl)=>({...c,controlVersion:c.controlVersion+1,nextOrdinal:Math.max(c.nextOrdinal,ordinal+1)}));
   await projects.archiveMessage(projectId,{id:intent.messageId,ordinal,role:'user',text:answer.answer,status:'completed',contentVersion:1,clientMessageId:intent.messageId,speechReviewAction:{scope:'single_postmix_wav',challengeSha256:source.challengeRef.sha256,decision:'pronunciation_correct'}});
  }
  await recordUserCommandActivity(projects,owner,projectId,intent.messageId,canonicalHash({kind:'postmix_review_confirmation',challengeRef:source.challengeRef,questionItemId:answer.questionItemId}));
  const reviewRef=await confirmPostMixReview(projects,owner,projectId,source.challengeRef,intent.messageId),proof=await loadConfirmedPostMixReview(new FileStore(root),projectId,reviewRef);verifyReviewedPostMixText(context,proof);report.reviewRef=reviewRef;report.confirmationMessageId=intent.messageId;await persistProbeReport(path,report);
  const digest=context.window.mediaRuntimeDigest,asr=context.transcript.runtimeDigest,env={VIDEO_MEDIA_IMAGE_REF:'sha256:'+digest,VIDEO_MEDIA_RUNTIME_DIGEST:digest,VIDEO_MEDIA_TIMEOUT_SECONDS:'600',VIDEO_ASR_IMAGE_REF:'sha256:'+asr,VIDEO_ASR_RUNTIME_DIGEST:asr,VIDEO_ASR_MODEL:context.transcript.model};
  const assertActive=async()=>{const c=await projects.access(owner,projectId);if(c.consentEpoch!==before.consentEpoch||c.briefVersion!==before.briefVersion||canonicalHash(c.understandingRef)!==canonicalHash(before.understandingRef)||c.activeProduction!==before.activeProduction)throw Error('BOOK_MIX_REVIEW_STALE')};
  const options={journal,assertActive,resolveReview:(value:PostMixReviewContext)=>findConfirmedPostMixReview(store,projectId,value)},result=await verifyPostMixNarration(root,context.film,context.plan,verified,env,undefined,options);report.result=result;await persistProbeReport(path,report);
  const middle=await store.listKeys(journal.prefix,1),cold=await verifyPostMixNarration(root,context.film,context.plan,verified,env,undefined,{...options,mustExist:true});if(canonicalHash(cold)!==canonicalHash(result)||canonicalHash(middle)!==canonicalHash(await store.listKeys(journal.prefix,1)))throw Error('BOOK_MIX_COLD_CHANGED');
  const after=await projects.access(owner,projectId);if(after.phase!==before.phase||after.currentPreviewId!==before.currentPreviewId||canonicalHash(hashes)!==canonicalHash(await Promise.all(sourceKeys.map(async key=>canonicalHash((await store.readFresh(key)).value)))))throw Error('BOOK_MIX_SOURCE_CHANGED');
  report.coldMatches=true;report.sourceOperationAndBudgetUnchanged=true;report.nativeInvocationCountBefore=beforeKeys.length;report.nativeInvocationCountAfter=middle.length;report.userPreference=answer.preference;report.status='full_new_book_postmix_verified_with_explicit_user_reply';
 }catch(error){report.status='failed';report.errorCode=String((error as Error).message).slice(0,300);process.exitCode=1}
 finally{await persistProbeReport(path,report);console.log(JSON.stringify({status:report.status,errorCode:report.errorCode,newModelCalls:0,nativeInvocationCountBefore:report.nativeInvocationCountBefore,nativeInvocationCountAfter:report.nativeInvocationCountAfter}))}
}
main().catch(error=>{console.error(error.message);process.exitCode=1});
