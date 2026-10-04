import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import type {ObjectRef} from '../../src/contracts/video/domain';
import {FileStore} from '../../src/services/video/storage/file-store';
import {canonicalHash} from '../../src/services/video/domain/hash';
import {readNarrationJson} from '../../src/services/video/audio/narration-package';
import type {NarrationPlan} from '../../src/services/video/audio/narration';
import type {VerifiedNarrationManifest} from '../../src/services/video/audio/asr';
import {verifyPostMixNarration} from '../../src/services/video/audio/postmix-asr';
import {findConfirmedPostMixReview} from '../../src/services/video/audio/postmix-review';
import {claimProbeReport,persistProbeReport} from './helpers/probe-report';
async function main(){
 const coldOnly=process.argv.includes('--recover-existing-final-mix');
 if(!process.argv.includes('--verified-existing-final-mix')&&!coldOnly)throw Error('EXPLICIT_EXISTING_FINAL_MIX_REQUIRED');
 const source=JSON.parse(await readFile('docs/engineering/evidence/new-theme-accounted-audio-preview-probe.json','utf8')),mix=JSON.parse(await readFile('docs/engineering/evidence/accounted-preview-postmix-probe.json','utf8')),confirmation=JSON.parse(await readFile('docs/engineering/evidence/new-theme-postmix-trusted-review-probe.json','utf8')),op=source.stages.operation;
 if(op.status!=='failed'||op.stage!=='composition'||confirmation.status!=='trusted_review'||confirmation.filmSha256!==mix.filmSha256||confirmation.sourceOperationId!==op.id)throw Error('KNOWN_FROZEN_FINAL_MIX_REQUIRED');
 const store=new FileStore(source.root),prefix=`projects/${op.projectId}`,keys=[prefix+'/control',prefix+'/budget',prefix+'/operations/'+op.id],before=await Promise.all(keys.map(async key=>canonicalHash((await store.readFresh(key)).value))),voice=(await store.readFresh<{planRef:ObjectRef;verifiedRef:ObjectRef}>(`${prefix}/revisions/${op.revisionId}/voice-stage`)).value;
 if(canonicalHash(voice)!==canonicalHash(source.stages.stageRecords['voice-stage']))throw Error('VOICE_STAGE_CHANGED');
 const revisionPrefix=`${prefix}/revisions/${op.revisionId}/`,plan=await readNarrationJson(store,voice.planRef,revisionPrefix) as NarrationPlan,verified=await readNarrationJson(store,voice.verifiedRef,revisionPrefix) as VerifiedNarrationManifest;
 if(canonicalHash(plan)!==confirmation.planSha256)throw Error('POSTMIX_REVIEW_CHANGED');
 const previous=coldOnly?JSON.parse(await readFile('docs/engineering/evidence/reviewed-final-mix-probe.json','utf8')):null;
 if(coldOnly&&(previous.status!=='blocked'||previous.errorCode!=='INVALID_KEY'||previous.filmSha256!==mix.filmSha256||previous.sourceOperationId!==op.id))throw Error('KNOWN_REPORT_LISTING_FAILURE_REQUIRED');
 const operationId=coldOnly?previous.diagnosticOperationId:randomUUID(),journal={store,prefix:prefix+'/operations/'+operationId+'/media-effects'},path=coldOnly?'docs/engineering/evidence/reviewed-final-mix-recovery-probe.json':'docs/engineering/evidence/reviewed-final-mix-probe.json',report:{[key:string]:unknown}={executedAt:new Date().toISOString(),status:'started',root:source.root,projectId:op.projectId,sourceOperationId:op.id,sourceRevisionId:op.revisionId,diagnosticOperationId:operationId,filmSha256:mix.filmSha256,planSha256:canonicalHash(plan),voiceManifestSha256:canonicalHash(verified),coldOnly,deliveryEligible:false,formalProductionApproval:false,fullFilmListeningApproval:false};
 await claimProbeReport(path,report);let networkCalls=0;globalThis.fetch=async()=>{networkCalls++;throw Error('MODEL_NETWORK_FORBIDDEN')};
 try{
 const media='75ffd41e03d738cee7e10914aeaeb2605b9daf213409afec295ccb97bb06c919',asr='caa3fca3e3e6866dab7351346367768db612bb411f06fbd4a7a44f767747f5d4',env={VIDEO_MEDIA_IMAGE_REF:'sha256:'+media,VIDEO_MEDIA_RUNTIME_DIGEST:media,VIDEO_MEDIA_TIMEOUT_SECONDS:'180',VIDEO_ASR_IMAGE_REF:'sha256:'+asr,VIDEO_ASR_RUNTIME_DIGEST:asr,VIDEO_ASR_MODEL:'Systran/faster-whisper-medium'},film={outputPath:mix.filmPath,sha256:mix.filmSha256,durationMs:plan.durationMs,technicalQa:'pass' as const};
 const result=await verifyPostMixNarration(source.root,film,plan,verified,env,undefined,{journal,mustExist:coldOnly,resolveReview:context=>findConfirmedPostMixReview(store,op.projectId,context)});
 const cold=new FileStore(source.root),recovered=await verifyPostMixNarration(source.root,film,plan,verified,env,undefined,{journal:{store:cold,prefix:journal.prefix},mustExist:true,resolveReview:context=>findConfirmedPostMixReview(cold,op.projectId,context)});
 if(canonicalHash(result)!==canonicalHash(recovered))throw Error('POSTMIX_RECOVERY_CHANGED');
 const invocations=await store.listKeys(journal.prefix,1),receipts=await Promise.all(invocations.map(async key=>(await store.readFresh(key)).value));
 if(receipts.length!==4||receipts.some(receipt=>(receipt as {state:string}).state!=='completed'))throw Error('NATIVE_INVOCATION_NOT_COMPLETED');
 Object.assign(report,{status:'full_postmix_verified',result,coldRecoveryIdentical:true,nativeInvocationCount:receipts.length,nativeReceipts:receipts,networkCalls,sourceStateUnchanged:canonicalHash(before)===canonicalHash(await Promise.all(keys.map(async key=>canonicalHash((await store.readFresh(key)).value)))),limits:'Actual frozen 20-second final AAC. Reads existing line 1/2 WAV and ASR; never-reached original-root line 3/4 extracted and recognized through four bounded owned native invocations. New diagnostic operation only; old failed production operation remains failed. Original source-only confirmation not accepted here. Cold full verification produces no new native/model work. This is speech technical verification, not listening, Critic, preview publication or formal delivery approval.'});
 if(report.sourceStateUnchanged!==true)throw Error('SOURCE_STATE_CHANGED');
 }catch(error){report.status='blocked';report.errorCode=(error as Error).message;report.networkCalls=networkCalls;process.exitCode=1}
 await persistProbeReport(path,report);console.log(JSON.stringify({status:report.status,errorCode:report.errorCode,result:report.result,nativeInvocationCount:report.nativeInvocationCount,coldRecoveryIdentical:report.coldRecoveryIdentical,networkCalls:report.networkCalls,sourceStateUnchanged:report.sourceStateUnchanged}));
}
main().catch(error=>{console.error(JSON.stringify({status:'blocked',errorCode:error.message}));process.exitCode=1});
