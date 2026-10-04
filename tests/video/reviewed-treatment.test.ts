import {expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import {mkdir,mkdtemp,rm,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {initialUnderstanding} from '@/contracts/video/domain';
import type {ProjectControl} from '@/contracts/video/project';
import {FileStore} from '@/services/video/storage/file-store';
import {ProjectStore} from '@/services/video/storage/project-store';
import {updateJson} from '@/services/video/storage/atomic-store';
import {LocalOperationQueue} from '@/services/video/commands/local-queue';
import {getStyle} from '@/services/video/styles/registry';
import {preparePreview,type PreviewOperation} from '@/services/video/preview/prepare';
import {prepareTreatmentStage} from '@/services/video/preview/treatment-stage';
import {compileVoicePlan} from '@/services/video/preview/voice-plan';
import {createSpeechReviewChallenge,confirmSpeechReview} from '@/services/video/audio/spoken-review';
import {probeVoiceWav} from '@/services/video/audio/wav';
import {canonicalHash} from '@/services/video/domain/hash';

async function fixture(root:string){
 const store=new FileStore(root),projects=new ProjectStore(store),owner='test-owner',queue=new LocalOperationQueue(store,root),{projectId}=await projects.create(owner,{schemaVersion:5,clientCommandId:randomUUID(),clientCreateId:randomUUID()});
 const sourceOperationId=randomUUID(),revisionId=randomUUID(),prefix=`projects/${projectId}`,base=initialUnderstanding(),style=getStyle('crayon-book'),messageId=randomUUID();
 await projects.archiveMessage(projectId,{id:messageId,ordinal:1,role:'user',text:'请先制作浇水的真实效果预览。',status:'completed',contentVersion:1,clientMessageId:messageId});
 const understanding={...base,briefVersion:1,subject:'浇水',preferences:{...base.preferences,durationSec:20,styleSlug:style.slug,voiceMode:'tts' as const,musicMode:'none' as const,captions:'none' as const}};
 const understandingRef=await projects.index.immutable(prefix+'/understanding/1',understanding);
 await updateJson(store,prefix+'/control',(c:ProjectControl)=>({...c,briefVersion:1,understandingRef,phase:'preparing_preview' as const,activeProduction:sourceOperationId}));
 const plan={schemaVersion:1,briefVersion:1,styleSlug:style.slug,styleRulesHash:style.rulesHash,durationSec:20,aspect:'16:9',fps:24,summary:'浇水',options:[{id:'a',concept:'浇水',visualApproach:'蜡笔绘制',soundApproach:'柔和配乐',tradeoff:'动作较多'},{id:'b',concept:'纸页',visualApproach:'翻页',soundApproach:'纸声',tradeoff:'人物较少'},{id:'c',concept:'角色',visualApproach:'人物浇水',soundApproach:'水声',tradeoff:'人物较复杂'}],selectedOptionId:'a',selectionReason:'表达清晰',shots:[{id:'shot',startFrame:0,endFrame:480,visualIntent:'适量浇水',scriptLine:'洒下水。',factIds:[]}],script:['洒下水。']};
 const treatmentRef=await prepareTreatmentStage(projects,projectId,revisionId,sourceOperationId,0,{decide:async()=>plan,limits:{projectCalls:5,projectInputTokens:200000,projectOutputTokens:20000,dailyCalls:10}});
 const voicePlan=compileVoicePlan(plan,understanding),line=voicePlan.lines[0];
 // Protocol fixture: synthetic PCM is not evidence of real pronunciation.
 const wav=Buffer.alloc(44+96000);wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(3,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(24000,24);wav.writeUInt32LE(96000,28);wav.writeUInt16LE(4,32);wav.writeUInt16LE(32,34);wav.write('data',36);wav.writeUInt32LE(96000,40);for(let i=0;i<24000;i++)wav.writeFloatLE(Math.sin(i/20)*0.1,44+i*4);
 await mkdir(join(root,'voice','fixture'),{recursive:true});const outputPath=join(root,'voice','fixture','narration.wav');await writeFile(outputPath,wav);
 const voice={lineId:line.lineId,language:line.language,voice:'zf_001' as const,provider:'kokoro-js' as const,model:'protocol-fixture',modelLicense:'Apache-2.0' as const,runtimeDigest:'a'.repeat(64),outputPath,wav:probeVoiceWav(wav)};
 const transcript={language:line.language,model:'Systran/faster-whisper-medium' as const,runtimeDigest:'b'.repeat(64),voiceSha256:voice.wav.sha256,recognizedText:'撒下水。',segments:[{text:'撒下水。',startMs:0,endMs:700,words:[{text:'撒下水。',startMs:0,endMs:700,probability:0.95}]}]};
 const challengeRef=await createSpeechReviewChallenge(projects,root,projectId,revisionId,voicePlan,line.lineId,voice,transcript),confirmationMessageId=randomUUID();
 await projects.archiveMessage(projectId,{id:confirmationMessageId,ordinal:2,role:'user',text:'读音正确，确认这句试听复核',status:'completed',contentVersion:1,clientMessageId:confirmationMessageId});
 const reviewRef=await confirmSpeechReview(projects,owner,projectId,challengeRef,confirmationMessageId);
 const source:PreviewOperation&{errorCode:string;stage:string}={id:sourceOperationId,projectId,commandId:randomUUID(),kind:'preview',status:'failed',canonicalRunId:sourceOperationId,streamEpoch:0,fence:0,revisionId,previewId:randomUUID(),briefVersion:1,consentEpoch:0,understandingRef,mediaAttemptStarted:true,errorCode:'ASR_MISMATCH',stage:'voice'};
 await store.create(prefix+'/operations/'+sourceOperationId,source);
 await updateJson(store,prefix+'/control',(c:ProjectControl)=>({...c,phase:'attention' as const,activeProduction:null}));
 return{store,projects,owner,queue,projectId,prefix,source,plan,reviewedTreatment:{sourceOperationId,treatmentRef,reviewRef},request:{schemaVersion:5 as const,clientCommandId:randomUUID(),expectedBriefVersion:1,sourceMessageId:messageId}};
}
it('continues a known pronunciation failure with the real frozen plan, a new operation and no new Treatment effect',async()=>{
 const root=await mkdtemp(join(tmpdir(),'vb-reviewed-treatment-'));
 try{
  const f=await fixture(root),budgetBefore=(await f.store.readFresh(f.prefix+'/budget')).value;
  const receipt=await preparePreview(f.projects,f.queue,f.owner,f.projectId,f.request,{reviewedTreatment:f.reviewedTreatment});
  const next=(await f.store.readFresh<PreviewOperation>(f.prefix+'/operations/'+receipt.operationId)).value;
  expect(next.id).not.toBe(f.source.id);expect(next.revisionId).not.toBe(f.source.revisionId);
  expect(await preparePreview(f.projects,f.queue,f.owner,f.projectId,f.request,{reviewedTreatment:f.reviewedTreatment})).toMatchObject({operationId:next.id,status:'replayed'});
  await rm(f.store.path(f.prefix+'/operations/'+next.id+'/reviewed-treatment-reuse')); // crash after activation, before reuse record publication
  let calls=0;
  const ref=await prepareTreatmentStage(new ProjectStore(new FileStore(root)),f.projectId,next.revisionId,next.id,0,{decide:async()=>{calls++;throw Error('NEW_CREATION_FORBIDDEN')}});
  expect(calls).toBe(0);expect(ref.sha256).toBe(f.reviewedTreatment.treatmentRef.sha256);
  expect(canonicalHash((await f.store.readFresh(f.prefix+'/budget')).value)).toBe(canonicalHash(budgetBefore));
  expect((await f.store.readFresh(f.prefix+'/operations/'+f.source.id)).value).toEqual(f.source);
  expect((await f.store.readFresh(ref.key)).value).toEqual(f.plan);
 }finally{await rm(root,{recursive:true,force:true})}
});
it('rejects unknown effects and changed baselines before reserving a new preview command',async()=>{
 const root=await mkdtemp(join(tmpdir(),'vb-reviewed-treatment-reject-'));
 try{
  const f=await fixture(root),before=await f.projects.access(f.owner,f.projectId),effectKey=f.prefix+'/operations/'+f.source.id+'/effects/treatment/'+f.source.revisionId,effect=await f.store.readFresh<Record<string,unknown>>(effectKey);
  await f.store.cas(effectKey,effect.etag,{...effect.value,status:'started'});
  await expect(preparePreview(f.projects,f.queue,f.owner,f.projectId,f.request,{reviewedTreatment:f.reviewedTreatment})).rejects.toThrow('TREATMENT_REUSE_UNKNOWN');
  expect(await f.projects.access(f.owner,f.projectId)).toEqual(before);
  await f.store.cas(effectKey,(await f.store.readFresh(effectKey)).etag,effect.value);
  await updateJson(f.store,f.prefix+'/control',(c:ProjectControl)=>({...c,consentEpoch:1}));
  await expect(preparePreview(f.projects,f.queue,f.owner,f.projectId,f.request,{reviewedTreatment:f.reviewedTreatment})).rejects.toThrow('TREATMENT_REUSE_CHANGED');
 }finally{await rm(root,{recursive:true,force:true})}
});

it('never falls through to new creation when a reviewed command disappears before cold recovery',async()=>{
 const root=await mkdtemp(join(tmpdir(),'vb-reviewed-command-loss-'));
 try{
  const f=await fixture(root),receipt=await preparePreview(f.projects,f.queue,f.owner,f.projectId,f.request,{reviewedTreatment:f.reviewedTreatment}),next=(await f.store.readFresh<PreviewOperation>(f.prefix+'/operations/'+receipt.operationId)).value;
  await rm(f.store.path(f.prefix+'/operations/'+next.id+'/reviewed-treatment-reuse'));
  const commandKey=f.prefix+'/commands/'+f.request.clientCommandId,command=(await f.store.readFresh<Record<string,unknown>>(commandKey)).value;
  await rm(f.store.path(commandKey));
  const {readReviewedTreatment}=await import('@/services/video/preview/reviewed-treatment');
  await expect(readReviewedTreatment(f.projects,f.projectId,next.id,next.revisionId,0)).rejects.toThrow('TREATMENT_REUSE_CHANGED');
  await f.store.create(commandKey,{...command,reviewedTreatment:undefined});
  await expect(readReviewedTreatment(f.projects,f.projectId,next.id,next.revisionId,0)).rejects.toThrow('TREATMENT_REUSE_CHANGED');
 }finally{await rm(root,{recursive:true,force:true})}
});
