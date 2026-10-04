import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import type {ObjectRef} from '../../src/contracts/video/domain';
import type {ProjectControl} from '../../src/contracts/video/project';
import {FileStore} from '../../src/services/video/storage/file-store';
import {ProjectStore} from '../../src/services/video/storage/project-store';
import {createOrRead,updateJson} from '../../src/services/video/storage/atomic-store';
import {canonicalHash} from '../../src/services/video/domain/hash';
import {recordUserCommandActivity} from '../../src/services/video/commands/user-activity';
import {readNarrationJson} from '../../src/services/video/audio/narration-package';
import type {NarrationPlan} from '../../src/services/video/audio/narration';
import {transcribeAudio,type VerifiedNarrationManifest} from '../../src/services/video/audio/asr';
import {inspectVoiceWav} from '../../src/services/video/audio/wav';
import {createPostMixReviewChallenge,confirmPostMixReview,loadConfirmedPostMixReview,verifyReviewedPostMixText,findConfirmedPostMixReview,type PostMixReviewContext} from '../../src/services/video/audio/postmix-review';
import {claimProbeReport,persistProbeReport} from './helpers/probe-report';
async function main(){
 if(!process.argv.includes('--confirmed-final-mix-workspace-reply'))throw Error('EXPLICIT_POSTMIX_CONFIRMATION_REQUIRED');
 const answer=JSON.parse(await readFile('docs/engineering/evidence/new-theme-postmix-spoken-review-confirmation.json','utf8'));
 if(answer.authority!=='actual_workspace_user_reply'||answer.answer!=='读音正确，确认这句最终混音试听复核'||answer.questionItemId!=='["request_user_input_async","call_w3nhpgt25ucu1Dh6BHs3pAhh",0]'||answer.scope!=='single_postmix_wav'||answer.decision!=='pronunciation_correct'||answer.formalProductionApproval!==false||answer.fullFilmListeningApproval!==false||answer.filmSha256!=='7c381b9b2f75e9a05ccaa7e542686268df18a23c02fff7dd487cabcf00312ce3'||answer.voiceSha256!=='e7683805520462ea967123d8082cc306fb9b18cd8360aae9d920530526a42967')throw Error('EXPLICIT_POSTMIX_CONFIRMATION_REQUIRED');
 const source=JSON.parse(await readFile('docs/engineering/evidence/new-theme-accounted-audio-preview-probe.json','utf8')),evidence=JSON.parse(await readFile('docs/engineering/evidence/accounted-preview-postmix-probe.json','utf8')),op=source.stages.operation;
 if(op.projectId!==answer.projectId||op.id!==answer.sourceOperationId||op.revisionId!==answer.sourceRevisionId||op.status!=='failed'||op.stage!=='composition'||evidence.filmSha256!==answer.filmSha256)throw Error('POSTMIX_REVIEW_CHANGED');
 const path='docs/engineering/evidence/new-theme-postmix-trusted-review-probe.json',report:{[key:string]:unknown}={executedAt:new Date().toISOString(),status:'started',projectId:answer.projectId,sourceOperationId:op.id,sourceRevisionId:op.revisionId,formalProductionApproval:false,fullFilmListeningApproval:false};
 await claimProbeReport(path,report);
 let networkCalls=0;globalThis.fetch=async()=>{networkCalls++;throw Error('POSTMIX_REVIEW_NETWORK_FORBIDDEN')};
 try{
 const store=new FileStore(source.root),projects=new ProjectStore(store),owner='new-theme-validation',prefix=`projects/${op.projectId}`,before=await projects.access(owner,op.projectId),operation=(await store.readFresh(prefix+'/operations/'+op.id)).value,budget=(await store.readFresh(prefix+'/budget')).value;
 if(canonicalHash(operation)!==canonicalHash(op))throw Error('POSTMIX_REVIEW_CHANGED');
 const voice=(await store.readFresh<{planRef:ObjectRef;verifiedRef:ObjectRef}>(`${prefix}/revisions/${op.revisionId}/voice-stage`)).value;
 if(canonicalHash(voice)!==canonicalHash(source.stages.stageRecords['voice-stage']))throw Error('POSTMIX_REVIEW_CHANGED');
 const revisionPrefix=`${prefix}/revisions/${op.revisionId}/`,plan=await readNarrationJson(store,voice.planRef,revisionPrefix) as NarrationPlan,verified=await readNarrationJson(store,voice.verifiedRef,revisionPrefix) as VerifiedNarrationManifest;
 const ordered=[...verified.lines].sort((a,b)=>a.startMs-b.startMs),index=ordered.findIndex(line=>line.lineId===answer.lineId),line=ordered[index],existing=evidence.lines.find((row:{lineId:string})=>row.lineId===answer.lineId);
 if(!line||!existing||existing.status!=='ASR_MISMATCH'||canonicalHash(plan)!==answer.planSha256||line.spokenText!==answer.spokenText||line.expectedAsrText!==answer.expectedAsrText)throw Error('POSTMIX_REVIEW_CHANGED');
 const wav=await inspectVoiceWav(existing.outputPath);if(wav.sha256!==answer.voiceSha256)throw Error('POSTMIX_REVIEW_CHANGED');
 const transcript=await transcribeAudio(source.root,{language:line.language,outputPath:existing.outputPath,wav},'postmix',{VIDEO_ASR_IMAGE_REF:'sha256:'+answer.asrRuntimeDigest,VIDEO_ASR_RUNTIME_DIGEST:answer.asrRuntimeDigest,VIDEO_ASR_MODEL:'Systran/faster-whisper-medium'},{mustExist:true});
 if(canonicalHash(transcript)!==answer.transcriptSha256||transcript.recognizedText!==answer.recognizedText)throw Error('POSTMIX_REVIEW_CHANGED');
 const context:PostMixReviewContext={film:{outputPath:evidence.filmPath,sha256:answer.filmSha256,durationMs:plan.durationMs,technicalQa:'pass'},plan,lineId:line.lineId,window:{startMs:line.startMs,lengthMs:Math.min(line.durationMs+300,(ordered[index+1]?.startMs??plan.durationMs)-line.startMs,plan.durationMs-line.startMs),mediaRuntimeDigest:'75ffd41e03d738cee7e10914aeaeb2605b9daf213409afec295ccb97bb06c919'},transcript};
 const challengeRef=await createPostMixReviewChallenge(projects,source.root,op.projectId,op.revisionId,context),intent=await createOrRead(store,`${prefix}/workspace-postmix-confirmations/${canonicalHash(answer)}`,{messageId:randomUUID(),challengeRef});
 if(canonicalHash(intent.challengeRef)!==canonicalHash(challengeRef))throw Error('POSTMIX_REVIEW_CHANGED');
 const messages=await projects.messages(await projects.access(owner,op.projectId));
 if(!messages.some(message=>message.id===intent.messageId)){
 const ordinal=Math.max(before.nextOrdinal,...messages.map(message=>message.ordinal+1));
 await updateJson(store,prefix+'/control',(control:ProjectControl)=>({...control,controlVersion:control.controlVersion+1,nextOrdinal:Math.max(control.nextOrdinal,ordinal+1)}));
 await projects.archiveMessage(op.projectId,{id:intent.messageId,ordinal,role:'user',text:answer.answer,status:'completed',contentVersion:1,clientMessageId:intent.messageId});
 }
 await recordUserCommandActivity(projects,owner,op.projectId,intent.messageId,canonicalHash({kind:'postmix_review_confirmation',challengeRef,questionItemId:answer.questionItemId}));
 const reviewRef=await confirmPostMixReview(projects,owner,op.projectId,challengeRef,intent.messageId),cold=new FileStore(source.root),proof=await loadConfirmedPostMixReview(cold,op.projectId,reviewRef),checked=verifyReviewedPostMixText(context,proof),found=await findConfirmedPostMixReview(cold,op.projectId,context),after=await projects.access(owner,op.projectId);
 if(networkCalls||!found||canonicalHash(found.ref)!==canonicalHash(reviewRef)||canonicalHash((await store.readFresh(prefix+'/operations/'+op.id)).value)!==canonicalHash(operation)||canonicalHash((await store.readFresh(prefix+'/budget')).value)!==canonicalHash(budget)||canonicalHash(after.understandingRef)!==canonicalHash(before.understandingRef)||after.phase!==before.phase||after.activeProduction!==before.activeProduction)throw Error('POSTMIX_REVIEW_CHANGED');
 Object.assign(report,{status:checked.status,root:source.root,challengeRef,reviewRef,confirmationMessageId:intent.messageId,filmSha256:answer.filmSha256,planSha256:canonicalHash(plan),mixedWavSha256:wav.sha256,transcript,checked,networkCalls,operationAndBudgetUnchanged:true,literalAsrMatch:false,limits:'Only the actual confirmed final AAC-extracted single sentence. Existing film/WAV/ASR read and hashes checked; no media/model producers, expectation rewrite, operation reset, formal authorization or full-film quality approval. Public review UI and technical continuation remain outstanding.'});
 }catch(error){report.status='blocked';report.errorCode=(error as Error).message;report.networkCalls=networkCalls;process.exitCode=1}
 await persistProbeReport(path,report);console.log(JSON.stringify({status:report.status,errorCode:report.errorCode,filmSha256:report.filmSha256,networkCalls:report.networkCalls,operationAndBudgetUnchanged:report.operationAndBudgetUnchanged}));
}
main().catch(error=>{console.error(JSON.stringify({status:'blocked',errorCode:error.message}));process.exitCode=1});
