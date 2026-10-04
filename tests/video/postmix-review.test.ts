import {expect,it} from 'vitest';
import {createHash,randomUUID} from 'node:crypto';
import {mkdir,mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {verifyPostMixNarration} from '@/services/video/audio/postmix-asr';
import type {ProjectControl} from '@/contracts/video/project';
import {updateJson} from '@/services/video/storage/atomic-store';
import {findConfirmedPostMixReview} from '@/services/video/audio/postmix-review';
import {resolvePreviewPostMixReview} from '@/services/video/preview/postmix-review';
import {FileStore} from '@/services/video/storage/file-store';
import {ProjectStore} from '@/services/video/storage/project-store';
import {canonicalHash} from '@/services/video/domain/hash';
import type {NarrationPlan} from '@/services/video/audio/narration';
import type {AsrTranscript} from '@/services/video/audio/asr';
import {verifySpokenText,type VerifiedNarrationManifest} from '@/services/video/audio/asr';
import {inspectVoiceWav} from '@/services/video/audio/wav';
import {assertPostMixReviewChallenge,createPostMixReviewChallenge,confirmPostMixReview,loadConfirmedPostMixReview,verifyReviewedPostMixText} from '@/services/video/audio/postmix-review';

async function fixture(root:string){
 const projects=new ProjectStore(new FileStore(root)),owner='mixed-review-owner';
 const {projectId}=await projects.create(owner,{schemaVersion:5,clientCommandId:randomUUID(),clientCreateId:randomUUID()}),revisionId=randomUUID();
 const plan:NarrationPlan={durationMs:20000,lines:[{lineId:'line_2',language:'zh-CN',spokenText:'洒下适量的水，润湿土壤。',displayText:'洒下适量的水，润湿土壤。',expectedAsrText:'洒下适量的水，润湿土壤。',startMs:5000,reservedMs:800}]};
 // Synthetic container and PCM test ownership/hash boundaries, not real speech QA.
 const filmDir=join(root,'composition','fixture');await mkdir(filmDir,{recursive:true});const bytes=Buffer.alloc(2048,1),outputPath=join(filmDir,'final.mp4');await writeFile(outputPath,bytes);
 const film={outputPath,sha256:createHash('sha256').update(bytes).digest('hex'),durationMs:20000,technicalQa:'pass' as const};
 const window={startMs:5000,lengthMs:1000,mediaRuntimeDigest:'a'.repeat(64)};
 const key=createHash('sha256').update(JSON.stringify([film.sha256,'line_2','zh-CN',window.startMs,window.lengthMs,window.mediaRuntimeDigest,'postmix-v1'])).digest('hex'),dir=join(root,'postmix',key,'output');await mkdir(dir,{recursive:true});
 const pcm=Buffer.alloc(44+96000);pcm.write('RIFF');pcm.writeUInt32LE(pcm.length-8,4);pcm.write('WAVEfmt ',8);pcm.writeUInt32LE(16,16);pcm.writeUInt16LE(3,20);pcm.writeUInt16LE(1,22);pcm.writeUInt32LE(24000,24);pcm.writeUInt32LE(96000,28);pcm.writeUInt16LE(4,32);pcm.writeUInt16LE(32,34);pcm.write('data',36);pcm.writeUInt32LE(96000,40);for(let n=0;n<24000;n++)pcm.writeFloatLE(Math.sin(n/20)*0.1,44+n*4);
 const mixedPath=join(dir,'line.wav');await writeFile(mixedPath,pcm);const wav=await inspectVoiceWav(mixedPath);
 const transcript:AsrTranscript={language:'zh-CN',model:'Systran/faster-whisper-medium',runtimeDigest:'b'.repeat(64),voiceSha256:wav.sha256,recognizedText:'撒下适量的水 润湿土壤',segments:[{text:'撒下适量的水 润湿土壤',startMs:0,endMs:700,words:[{text:'撒下适量的水 润湿土壤',startMs:0,endMs:700,probability:0.95}]}]};
 const context={film,plan,lineId:'line_2',window,transcript};
 const challenge=await createPostMixReviewChallenge(projects,root,projectId,revisionId,context),messageId=randomUUID();
 await projects.archiveMessage(projectId,{id:messageId,ordinal:1,role:'user',text:'读音正确，确认这句最终混音试听复核',status:'completed',contentVersion:1,clientMessageId:messageId});
 return{projects,owner,projectId,revisionId,context,challenge,messageId,wav,mixedPath};
}
it('cold loads an owned final-mix review and preserves the literal mismatch and source-only boundary',async()=>{
 const root=await mkdtemp(join(tmpdir(),'vb-mixed-review-'));
 try{
  const f=await fixture(root);await expect(confirmPostMixReview(f.projects,'other',f.projectId,f.challenge,f.messageId)).rejects.toThrow('ACCESS_NOT_FOUND');
  const ref=await confirmPostMixReview(f.projects,f.owner,f.projectId,f.challenge,f.messageId),proof=await loadConfirmedPostMixReview(new FileStore(root),f.projectId,ref);
  expect(verifyReviewedPostMixText(f.context,proof)).toMatchObject({status:'trusted_review',recognizedText:f.context.transcript.recognizedText,speechReviewRef:ref});
  expect(()=>verifySpokenText(f.context.plan.lines[0].expectedAsrText,f.context.plan.lines[0].expectedAsrText,f.context.transcript)).toThrow('ASR_MISMATCH');
  expect(()=>verifyReviewedPostMixText(f.context,JSON.parse(JSON.stringify(proof)))).toThrow('POSTMIX_REVIEW_UNTRUSTED');
  expect(()=>verifySpokenText(f.context.plan.lines[0].expectedAsrText,f.context.plan.lines[0].expectedAsrText,f.context.transcript,proof as never)).toThrow('SPEECH_REVIEW_UNTRUSTED');
  for(const context of [{...f.context,film:{...f.context.film,sha256:'c'.repeat(64)}},{...f.context,window:{...f.context.window,startMs:5001}},{...f.context,plan:{...f.context.plan,durationMs:21000}},{...f.context,transcript:{...f.context.transcript,voiceSha256:'c'.repeat(64)}}])expect(()=>verifyReviewedPostMixText(context,proof)).toThrow('POSTMIX_REVIEW_CHANGED');
  expect(()=>Object.assign(proof.challenge,{filmSha256:'c'.repeat(64)})).toThrow(TypeError);
 }finally{await rm(root,{recursive:true,force:true})}
});
it('does not accept source-WAV confirmation, repeated message rebinding or broken timing',async()=>{
 const root=await mkdtemp(join(tmpdir(),'vb-mixed-review-scope-'));
 try{
  const f=await fixture(root),wrongId=randomUUID();await f.projects.archiveMessage(f.projectId,{id:wrongId,ordinal:2,role:'user',text:'读音正确，确认这句试听复核',status:'completed',contentVersion:1,clientMessageId:wrongId});
  await expect(confirmPostMixReview(f.projects,f.owner,f.projectId,f.challenge,wrongId)).rejects.toThrow('POSTMIX_REVIEW_CONFIRMATION_REQUIRED');
  await confirmPostMixReview(f.projects,f.owner,f.projectId,f.challenge,f.messageId);
  const changed={...f.context,plan:{...f.context.plan,lines:[{...f.context.plan.lines[0],displayText:'其他文本'}]}};
  const other=await createPostMixReviewChallenge(f.projects,root,f.projectId,f.revisionId,changed);await expect(confirmPostMixReview(f.projects,f.owner,f.projectId,other,f.messageId)).rejects.toThrow('POSTMIX_REVIEW_CHANGED');
  const beyondNext={...f.context,plan:{...f.context.plan,lines:[...f.context.plan.lines,{...f.context.plan.lines[0],lineId:'line_3',startMs:5900,reservedMs:5000}]}};
  await expect(createPostMixReviewChallenge(f.projects,root,f.projectId,f.revisionId,beyondNext)).rejects.toThrow('POSTMIX_REVIEW_CHANGED');
  const beyondTail={...f.context,window:{...f.context.window,lengthMs:1200}};
  await expect(createPostMixReviewChallenge(f.projects,root,f.projectId,f.revisionId,beyondTail)).rejects.toThrow('POSTMIX_REVIEW_CHANGED');
  const zero=structuredClone(f.context);zero.transcript.segments[0].words[0].endMs=0;
  await expect(createPostMixReviewChallenge(f.projects,root,f.projectId,f.revisionId,zero)).rejects.toThrow('ASR_TIMINGS_UNAVAILABLE');
  const missing=structuredClone(f.context);missing.transcript.segments[0].words=[];
  await expect(createPostMixReviewChallenge(f.projects,root,f.projectId,f.revisionId,missing)).rejects.toThrow('ASR_TIMINGS_UNAVAILABLE');
 }finally{await rm(root,{recursive:true,force:true})}
});
it('cold loading rejects a newly signed record that rebinds a real message to a different challenge',async()=>{
 const root=await mkdtemp(join(tmpdir(),'vb-mixed-review-forgery-'));
 try{
  const f=await fixture(root),ref=await confirmPostMixReview(f.projects,f.owner,f.projectId,f.challenge,f.messageId);
  const other=await createPostMixReviewChallenge(f.projects,root,f.projectId,randomUUID(),f.context),record=(await f.projects.store.readFresh(ref.key)).value as Record<string,unknown>;
  const forged=await f.projects.index.immutable(`projects/${f.projectId}/postmix-reviews`,{...record,challengeRef:other});
  expect(canonicalHash(record)).toBe(ref.sha256);await expect(loadConfirmedPostMixReview(new FileStore(root),f.projectId,forged)).rejects.toThrow('POSTMIX_REVIEW_CHANGED');
 }finally{await rm(root,{recursive:true,force:true})}
});

it('uses the final-mix proof through the real cold verifier without changing raw ASR or starting a producer',async()=>{
 const root=await mkdtemp(join(tmpdir(),'vb-mixed-review-verifier-'));
 try{
  const f=await fixture(root);await confirmPostMixReview(f.projects,f.owner,f.projectId,f.challenge,f.messageId);
  const {transcript}=f.context,key=createHash('sha256').update(JSON.stringify(['zh-CN',f.wav.sha256,transcript.runtimeDigest,'faster-whisper-medium'])).digest('hex'),dir=join(root,'asr',key);await mkdir(dir,{recursive:true});
  await writeFile(join(dir,'job.json'),JSON.stringify({language:'zh-CN'}));await writeFile(join(dir,'transcript.json'),JSON.stringify({language:transcript.language,model:transcript.model,segments:transcript.segments}));
  const line=f.context.plan.lines[0],verified:VerifiedNarrationManifest={durationMs:20000,lines:[{...line,durationMs:700,asrStatus:'pass',wordTimingsStatus:'available',voice:{lineId:line.lineId,language:'zh-CN',voice:'zf_001',provider:'kokoro-js',model:'fixture',modelLicense:'Apache-2.0',runtimeDigest:'c'.repeat(64),outputPath:f.mixedPath,wav:f.wav},asr:{model:transcript.model,runtimeDigest:transcript.runtimeDigest,voiceSha256:f.wav.sha256},recognizedText:line.spokenText,wordTimings:transcript.segments[0].words}]};
  const env={VIDEO_MEDIA_TIMEOUT_SECONDS:'180',VIDEO_MEDIA_IMAGE_REF:'sha256:'+f.context.window.mediaRuntimeDigest,VIDEO_MEDIA_RUNTIME_DIGEST:f.context.window.mediaRuntimeDigest,VIDEO_ASR_IMAGE_REF:'sha256:'+transcript.runtimeDigest,VIDEO_ASR_RUNTIME_DIGEST:transcript.runtimeDigest,VIDEO_ASR_MODEL:transcript.model};
  await expect(verifyPostMixNarration(root,f.context.film,f.context.plan,verified,env,undefined,{mustExist:true})).rejects.toThrow('POSTMIX_ASR_MISMATCH');
  const store=new FileStore(root),result=await verifyPostMixNarration(root,f.context.film,f.context.plan,verified,env,undefined,{mustExist:true,resolveReview:context=>findConfirmedPostMixReview(store,f.projectId,context)});
  expect(result).toMatchObject({status:'pass',filmSha256:f.context.film.sha256,lines:[{lineId:line.lineId,status:'trusted_review',recognizedText:transcript.recognizedText}]});
  await updateJson(f.projects.store,`projects/${f.projectId}/control`,(control:ProjectControl)=>({...control,consentEpoch:control.consentEpoch+1}));
  await expect(findConfirmedPostMixReview(store,f.projectId,f.context)).resolves.toBeUndefined();
  await expect(verifyPostMixNarration(root,f.context.film,f.context.plan,verified,env,undefined,{mustExist:true,resolveReview:context=>findConfirmedPostMixReview(store,f.projectId,context)})).rejects.toThrow('POSTMIX_ASR_MISMATCH');
 }finally{await rm(root,{recursive:true,force:true})}
});

it('persists a final-mix listening challenge on mismatch, with read-only recovery producing no new challenge',async()=>{
 const root=await mkdtemp(join(tmpdir(),'vb-preview-mixed-challenge-'));
 try{
  const f=await fixture(root),otherRevision=randomUUID(),prefix=`projects/${f.projectId}/postmix-review-challenges`;
  const before=await f.projects.store.listKeys!(prefix,1);
  await expect(resolvePreviewPostMixReview(f.projects,root,f.projectId,otherRevision,f.context,{mustExist:true})).resolves.toBeUndefined();
  expect(await f.projects.store.listKeys!(prefix,1)).toEqual(before);
  await expect(resolvePreviewPostMixReview(f.projects,root,f.projectId,otherRevision,f.context)).resolves.toBeUndefined();
  const after=await f.projects.store.listKeys!(prefix,1);expect(after).toHaveLength(before.length+1);
  const stored=await Promise.all(after.map(async key=>(await f.projects.store.readFresh<{sourceRevisionId:string;filmSha256:string;recognizedText:string}>(key)).value));
  expect(stored.find(c=>c.sourceRevisionId===otherRevision)).toMatchObject({filmSha256:f.context.film.sha256,recognizedText:f.context.transcript.recognizedText});
  await confirmPostMixReview(f.projects,f.owner,f.projectId,f.challenge,f.messageId);
  await expect(resolvePreviewPostMixReview(f.projects,root,f.projectId,otherRevision,f.context)).resolves.toMatchObject({challenge:{sourceRevisionId:f.revisionId}});
  expect(await f.projects.store.listKeys!(prefix,1)).toEqual(after);
 }finally{await rm(root,{recursive:true,force:true})}
});

it('preserves an explicit owner action and its actual free-form message, bound to one exact challenge',async()=>{
 const root=await mkdtemp(join(tmpdir(),'vb-postmix-owner-action-'));
 try{
  const f=await fixture(root),id=randomUUID(),text='读音正确，音频这快就全部通过，不需要每一个影片都来验证';
  await f.projects.archiveMessage(f.projectId,{id,ordinal:2,role:'user',text,status:'completed',contentVersion:1,clientMessageId:id,speechReviewAction:{scope:'single_postmix_wav',challengeSha256:f.challenge.sha256,decision:'pronunciation_correct'}});
  const ref=await confirmPostMixReview(f.projects,f.owner,f.projectId,f.challenge,id);
  expect(verifyReviewedPostMixText(f.context,await loadConfirmedPostMixReview(new FileStore(root),f.projectId,ref)).status).toBe('trusted_review');
  expect((await f.projects.messages(await f.projects.access(f.owner,f.projectId))).find(m=>m.id===id)?.text).toBe(text);
  expect((await f.projects.view(f.owner,f.projectId)).messages.find(m=>m.id===id)).not.toHaveProperty('speechReviewAction');
  const other=await createPostMixReviewChallenge(f.projects,root,f.projectId,randomUUID(),f.context);
  await expect(confirmPostMixReview(f.projects,f.owner,f.projectId,other,id)).rejects.toThrow('POSTMIX_REVIEW_CONFIRMATION_REQUIRED');
  const ordinary=randomUUID();await f.projects.archiveMessage(f.projectId,{id:ordinary,ordinal:3,role:'user',text,status:'completed',contentVersion:1,clientMessageId:ordinary});
  await expect(confirmPostMixReview(f.projects,f.owner,f.projectId,f.challenge,ordinary)).rejects.toThrow('POSTMIX_REVIEW_CONFIRMATION_REQUIRED');
 }finally{await rm(root,{recursive:true,force:true})}
});

it('validates the exact mixed challenge context before an owner decision can be archived',async()=>{
 const root=await mkdtemp(join(tmpdir(),'vb-mix-preconfirm-binding-'));
 try{
  const f=await fixture(root);await expect(assertPostMixReviewChallenge(f.projects.store,f.projectId,f.challenge,f.revisionId,f.context)).resolves.toBeUndefined();
  await expect(assertPostMixReviewChallenge(f.projects.store,f.projectId,f.challenge,randomUUID(),f.context)).rejects.toThrow('POSTMIX_REVIEW_CHANGED');
  await expect(assertPostMixReviewChallenge(f.projects.store,f.projectId,f.challenge,f.revisionId,{...f.context,film:{...f.context.film,sha256:'e'.repeat(64)}})).rejects.toThrow('POSTMIX_REVIEW_CHANGED');
 }finally{await rm(root,{recursive:true,force:true})}
});
