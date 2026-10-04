import {randomUUID} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import type {ProjectControl} from '../../src/contracts/video/project';
import type {Understanding} from '../../src/contracts/video/domain';
import {FileStore} from '../../src/services/video/storage/file-store';
import {ProjectStore} from '../../src/services/video/storage/project-store';
import {createOrRead,updateJson} from '../../src/services/video/storage/atomic-store';
import {canonicalHash} from '../../src/services/video/domain/hash';
import {recordUserCommandActivity} from '../../src/services/video/commands/user-activity';
import {compileVoicePlan} from '../../src/services/video/preview/voice-plan';
import {synthesizeVoice} from '../../src/services/video/audio/voice';
import {transcribeAudio,verifySpokenText} from '../../src/services/video/audio/asr';
import {createSpeechReviewChallenge,confirmSpeechReview,loadConfirmedSpeechReview} from '../../src/services/video/audio/spoken-review';

async function main(){
 if(!process.argv.includes('--confirmed-workspace-reply'))throw Error('EXPLICIT_SPEECH_CONFIRMATION_REQUIRED');
 const answer=JSON.parse(await readFile('docs/engineering/evidence/new-theme-spoken-review-confirmation.json','utf8'));
 if(answer.authority!=='actual_workspace_user_reply'||answer.answer!=='读音正确，确认这句试听复核'||answer.decision!=='pronunciation_correct'||answer.scope!=='single_original_wav'||answer.questionItemId!=='["request_user_input_async","call_xr7PZxISWSt7gVVwyN5MTMbq",0]'||answer.formalProductionApproval!==false||answer.voiceSha256!=='3c9f907ed0e6af737c4d2a21c709e1306c784f32759f1eeeb08a0c25a25a6c02')throw Error('EXPLICIT_SPEECH_CONFIRMATION_REQUIRED');
 const source=JSON.parse(await readFile('docs/engineering/evidence/new-theme-upgraded-probe.json','utf8'));
 if(source.projectId!==answer.projectId||source.stages.operation.id!==answer.sourceOperationId||source.stages.operation.revisionId!==answer.sourceRevisionId)throw Error('SPEECH_REVIEW_CHANGED');
 const store=new FileStore(source.root),projects=new ProjectStore(store),owner='new-theme-validation',prefix=`projects/${source.projectId}`;
 const before=await projects.access(owner,source.projectId),operation=(await store.readFresh(prefix+'/operations/'+answer.sourceOperationId)).value,budget=(await store.readFresh(prefix+'/budget')).value;
 if(canonicalHash(operation)!==canonicalHash(source.stages.operation)||source.stages.operation.status!=='failed'||source.stages.operation.errorCode!=='ASR_MISMATCH')throw Error('SPEECH_REVIEW_CHANGED');
 const understanding=(await store.readFresh<Understanding>(before.understandingRef.key)).value;if(canonicalHash(understanding)!==before.understandingRef.sha256)throw Error('SPEECH_REVIEW_CHANGED');
 const keys=await store.listKeys(`${prefix}/revisions/${answer.sourceRevisionId}/treatment-plan`,1);if(keys.length!==1)throw Error('SPEECH_REVIEW_CHANGED');
 const treatment=(await store.readFresh(keys[0])).value;if(!keys[0].endsWith('/'+canonicalHash(treatment)))throw Error('SPEECH_REVIEW_CHANGED');
 const plan=compileVoicePlan(treatment,understanding),line=plan.lines.find(item=>item.lineId===answer.lineId);
 if(!line||line.spokenText!==answer.spokenText||line.expectedAsrText!==answer.expectedAsrText)throw Error('SPEECH_REVIEW_CHANGED');
 let networkCalls=0;globalThis.fetch=async()=>{networkCalls++;throw Error('SPEECH_REVIEW_NETWORK_FORBIDDEN')};
 const env={VIDEO_VOICE_IMAGE_REF:'sha256:'+answer.voiceRuntimeDigest,VIDEO_VOICE_RUNTIME_DIGEST:answer.voiceRuntimeDigest,VIDEO_ASR_IMAGE_REF:'sha256:'+answer.asrRuntimeDigest,VIDEO_ASR_RUNTIME_DIGEST:answer.asrRuntimeDigest,VIDEO_ASR_MODEL:'Systran/faster-whisper-medium'};
 const voice=await synthesizeVoice(source.root,{lineId:line.lineId,language:line.language,text:line.spokenText},env,{mustExist:true});
 if(voice.wav.sha256!==answer.voiceSha256)throw Error('SPEECH_REVIEW_CHANGED');
 const transcript=await transcribeAudio(source.root,voice,'voice',env,{mustExist:true});if(transcript.recognizedText!==answer.recognizedText)throw Error('SPEECH_REVIEW_CHANGED');
 const challengeRef=await createSpeechReviewChallenge(projects,source.root,source.projectId,answer.sourceRevisionId,plan,line.lineId,voice,transcript);
 const intent=await createOrRead(store,`${prefix}/workspace-speech-confirmations/${canonicalHash(answer)}`,{messageId:randomUUID(),challengeRef});
 if(canonicalHash(intent.challengeRef)!==canonicalHash(challengeRef))throw Error('SPEECH_REVIEW_CHANGED');
 const messages=await projects.messages(await projects.access(owner,source.projectId)),existing=messages.find(item=>item.id===intent.messageId);
 if(!existing){
  const ordinal=Math.max(before.nextOrdinal,...messages.map(item=>item.ordinal+1));
  await updateJson(store,prefix+'/control',(control:ProjectControl)=>({...control,controlVersion:control.controlVersion+1,nextOrdinal:Math.max(control.nextOrdinal,ordinal+1)}));
  await projects.archiveMessage(source.projectId,{id:intent.messageId,ordinal,role:'user',text:answer.answer,status:'completed',contentVersion:1,clientMessageId:intent.messageId});
 }
 await recordUserCommandActivity(projects,owner,source.projectId,intent.messageId,canonicalHash({kind:'speech_review_confirmation',challengeRef,questionItemId:answer.questionItemId}));
 const reviewRef=await confirmSpeechReview(projects,owner,source.projectId,challengeRef,intent.messageId),proof=await loadConfirmedSpeechReview(new FileStore(source.root),source.projectId,reviewRef),verified=verifySpokenText(line.expectedAsrText,line.expectedAsrText,transcript,proof);
 const after=await projects.access(owner,source.projectId);
 if(networkCalls||canonicalHash((await store.readFresh(prefix+'/operations/'+answer.sourceOperationId)).value)!==canonicalHash(operation)||canonicalHash((await store.readFresh(prefix+'/budget')).value)!==canonicalHash(budget)||canonicalHash(after.understandingRef)!==canonicalHash(before.understandingRef)||after.phase!==before.phase||after.activeProduction!==before.activeProduction)throw Error('SPEECH_REVIEW_CHANGED');
 const report={executedAt:new Date().toISOString(),status:verified.status,root:source.root,projectId:source.projectId,sourceOperationId:answer.sourceOperationId,challengeRef,reviewRef,confirmationMessageId:intent.messageId,planSha256:canonicalHash(plan),voiceSha256:voice.wav.sha256,transcript,verified,literalAsrMatch:false,formalProductionApproval:false,networkCalls,operationAndBudgetUnchanged:true,limits:'Actual workspace-user confirmation archived as an owned user message and immutable single-WAV review. Existing original TTS/ASR evidence read with mustExist only, cold proof loaded; no media/model producer, script/transcript rewrite, failed-operation reset or preview/formal approval. The voice pipeline/package integration and other two unverified lines remain outstanding.'};
 await writeFile('docs/engineering/evidence/new-theme-trusted-review-probe.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:verified.status,voiceSha256:voice.wav.sha256,networkCalls,reviewRef}));
}
main().catch(error=>{console.error(JSON.stringify({status:'fail',errorCode:error.message}));process.exitCode=1});
