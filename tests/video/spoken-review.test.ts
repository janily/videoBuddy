import {expect,it} from 'vitest';
import {spawnSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {mkdir,mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {FileStore} from '@/services/video/storage/file-store';
import {ProjectStore} from '@/services/video/storage/project-store';
import type {ProjectControl} from '@/contracts/video/project';
import {updateJson} from '@/services/video/storage/atomic-store';
import {canonicalHash} from '@/services/video/domain/hash';
import {inspectVoiceWav} from '@/services/video/audio/wav';
import {verifySpokenText,verifyNarration,type AsrTranscript} from '@/services/video/audio/asr';
import type {VoiceResult} from '@/services/video/audio/voice';
import {prepareNarration,type NarrationPlan} from '@/services/video/audio/narration';
import {createSpeechReviewChallenge,confirmSpeechReview,loadConfirmedSpeechReview,findConfirmedSpeechReview} from '@/services/video/audio/spoken-review';

async function fixture(root:string,role:'user'|'assistant'='user',exportShape=false){
 const store=new FileStore(root),projects=new ProjectStore(store),owner='review-owner';
 const {projectId}=await projects.create(owner,{schemaVersion:5,clientCommandId:randomUUID(),clientCreateId:randomUUID()}),revisionId=randomUUID();
 const plan:NarrationPlan={durationMs:20000,lines:[{lineId:'line_2',language:'zh-CN',spokenText:'洒下适量的水，润湿土壤。',displayText:'洒下适量的水，润湿土壤。',expectedAsrText:'洒下适量的水，润湿土壤。',startMs:1000,reservedMs:19000}]};
 if(exportShape){plan.lines[0].lineId='line_1';plan.lines[0].startMs=0;plan.lines[0].reservedMs=20000}
 // Synthetic PCM exercises proof binding and storage; it is not a listening test.
 const pcm=Buffer.alloc(44+24000*4);pcm.write('RIFF');pcm.writeUInt32LE(pcm.length-8,4);pcm.write('WAVEfmt ',8);pcm.writeUInt32LE(16,16);pcm.writeUInt16LE(3,20);pcm.writeUInt16LE(1,22);pcm.writeUInt32LE(24000,24);pcm.writeUInt32LE(96000,28);pcm.writeUInt16LE(4,32);pcm.writeUInt16LE(32,34);pcm.write('data',36);pcm.writeUInt32LE(96000,40);for(let n=0;n<24000;n++)pcm.writeFloatLE(Math.sin(n/20)*0.1,44+n*4);
 const dir=join(root,'voice','fixture');await mkdir(dir,{recursive:true});const outputPath=join(dir,'narration.wav');await writeFile(outputPath,pcm);
 const voice:VoiceResult={lineId:plan.lines[0].lineId,language:'zh-CN',voice:'zf_001',provider:'kokoro-js',model:'fixture',modelLicense:'Apache-2.0',runtimeDigest:'a'.repeat(64),outputPath,wav:await inspectVoiceWav(outputPath)};
 const transcript:AsrTranscript={language:'zh-CN',model:'Systran/faster-whisper-medium',runtimeDigest:'b'.repeat(64),voiceSha256:voice.wav.sha256,recognizedText:'撒下适量的水，润湿土壤。',segments:[{text:'撒下适量的水，润湿土壤。',startMs:0,endMs:700,words:[{text:'撒下适量的水，润湿土壤。',startMs:0,endMs:700,probability:0.95}]}]};
 const challenge=await createSpeechReviewChallenge(projects,root,projectId,revisionId,plan,plan.lines[0].lineId,voice,transcript),messageId=randomUUID();
 await projects.archiveMessage(projectId,{id:messageId,ordinal:1,role,text:'读音正确，确认这句试听复核',status:'completed',contentVersion:1,clientMessageId:role==='user'?messageId:undefined});
 return{projects,owner,projectId,challenge,messageId,transcript,plan,voice};
}

it('requires an owned explicit human confirmation and preserves the original ASR mismatch',async()=>{
 const root=await mkdtemp(join(tmpdir(),'vb-spoken-review-'));
 try{
  const f=await fixture(root),expected=f.plan.lines[0].expectedAsrText;
  expect(()=>verifySpokenText(expected,expected,f.transcript)).toThrow('ASR_MISMATCH');
  await expect(confirmSpeechReview(f.projects,'other-owner',f.projectId,f.challenge,f.messageId)).rejects.toThrow('ACCESS_NOT_FOUND');
  const ref=await confirmSpeechReview(f.projects,f.owner,f.projectId,f.challenge,f.messageId);
  const proof=await loadConfirmedSpeechReview(new FileStore(root),f.projectId,ref);
  expect(verifySpokenText(expected,expected,f.transcript,proof)).toMatchObject({status:'trusted_review',recognizedText:'撒下适量的水，润湿土壤。'});
  expect(()=>verifySpokenText(expected,expected,f.transcript)).toThrow('ASR_MISMATCH');
  expect(()=>verifySpokenText(expected,'撒下适量的水，润湿土壤。',f.transcript,proof)).toThrow('ASR_EXPECTATION_CHANGED');
  expect(()=>verifySpokenText(expected,expected,{...f.transcript,voiceSha256:'c'.repeat(64)},proof)).toThrow('SPEECH_REVIEW_CHANGED');
  expect(()=>verifySpokenText(expected,expected,{...f.transcript,recognizedText:'撒下过量的水'},proof)).toThrow('SPEECH_REVIEW_CHANGED');
  expect(()=>verifySpokenText(expected,expected,f.transcript,JSON.parse(JSON.stringify(proof)))).toThrow('SPEECH_REVIEW_UNTRUSTED');
  expect(()=>Object.assign(proof.challenge,{expectedAsrText:'撒下适量的水，润湿土壤。'})).toThrow(TypeError);
 }finally{await rm(root,{recursive:true,force:true})}
});
it('does not accept an assistant message as a listening confirmation',async()=>{
 const root=await mkdtemp(join(tmpdir(),'vb-spoken-review-role-'));
 try{const f=await fixture(root,'assistant');await expect(confirmSpeechReview(f.projects,f.owner,f.projectId,f.challenge,f.messageId)).rejects.toThrow('SPEECH_REVIEW_CONFIRMATION_REQUIRED')}
 finally{await rm(root,{recursive:true,force:true})}
});

it('binds trusted review to the complete narration plan and retains it across cold packaging',async()=>{
 const root=await mkdtemp(join(tmpdir(),'vb-review-package-'));
 try{
  const f=await fixture(root),ref=await confirmSpeechReview(f.projects,f.owner,f.projectId,f.challenge,f.messageId),proof=await loadConfirmedSpeechReview(f.projects.store,f.projectId,ref);
  expect(await findConfirmedSpeechReview(f.projects.store,f.projectId,f.plan,f.plan.lines[0],f.voice,f.transcript)).toMatchObject({ref});
  const prepared=await prepareNarration(f.plan,root,async()=>f.voice),recognize=async()=>f.transcript;
  const verified=await verifyNarration(f.plan,prepared,root,recognize,async()=>proof);
  expect(verified.lines[0]).toMatchObject({asrStatus:'trusted_review',speechReview:{ref},recognizedText:f.transcript.recognizedText});
  const {archiveVerifiedNarration,loadPackagedNarration}=await import('@/services/video/audio/narration-package');
  const timing=[{lineId:f.voice.lineId,spokenText:f.plan.lines[0].spokenText,displayText:f.plan.lines[0].displayText,expectedAsrText:f.plan.lines[0].expectedAsrText,startSample:48000,endSample:96000,voiceSha256:f.voice.wav.sha256,voiceRuntimeDigest:f.voice.runtimeDigest,asrRuntimeDigest:f.transcript.runtimeDigest}];
  const revisionId=randomUUID(),archive=await archiveVerifiedNarration(f.projects,root,f.projectId,revisionId,verified,timing);
  const loaded=await loadPackagedNarration(new FileStore(root),root,f.projectId,revisionId,archive.sources[0].sourceRef);
  expect(loaded.words).toMatchObject({speechReview:{ref},recognizedText:f.transcript.recognizedText,words:f.transcript.segments[0].words});
  const changedPlan={...f.plan,lines:[{...f.plan.lines[0],displayText:'另一句显示文本'}]},changedPrepared=await prepareNarration(changedPlan,root,async()=>f.voice);
  await expect(verifyNarration(changedPlan,changedPrepared,root,recognize,async()=>proof)).rejects.toThrow('SPEECH_REVIEW_CHANGED');
  const forged=structuredClone(verified);forged.lines[0].wordTimings[0].endMs=600;
  await expect(archiveVerifiedNarration(f.projects,root,f.projectId,randomUUID(),forged,timing)).rejects.toThrow('SPEECH_REVIEW_CHANGED');
 }finally{await rm(root,{recursive:true,force:true})}
});
it('cannot reuse one human confirmation for another challenge or waive missing word timing',async()=>{
 const root=await mkdtemp(join(tmpdir(),'vb-review-scope-'));
 try{
  const f=await fixture(root);await confirmSpeechReview(f.projects,f.owner,f.projectId,f.challenge,f.messageId);
  const changed={...f.plan,lines:[{...f.plan.lines[0],displayText:'不同显示文本'}]};
  const other=await createSpeechReviewChallenge(f.projects,root,f.projectId,randomUUID(),changed,f.voice.lineId,f.voice,f.transcript);
  await expect(confirmSpeechReview(f.projects,f.owner,f.projectId,other,f.messageId)).rejects.toThrow('SPEECH_REVIEW_CHANGED');
  const zero=structuredClone(f.transcript);zero.segments[0].words[0].endMs=0;
  await expect(createSpeechReviewChallenge(f.projects,root,f.projectId,randomUUID(),f.plan,f.voice.lineId,f.voice,zero)).rejects.toThrow('ASR_TIMINGS_UNAVAILABLE');
 }finally{await rm(root,{recursive:true,force:true})}
});

it('cold loading rejects re-signed JSON that reuses another challenge confirmation message',async()=>{
 const root=await mkdtemp(join(tmpdir(),'vb-review-cold-forgery-'));
 try{
  const f=await fixture(root),ref=await confirmSpeechReview(f.projects,f.owner,f.projectId,f.challenge,f.messageId);
  const changed={...f.plan,lines:[{...f.plan.lines[0],displayText:'未确认的另一文本'}]};
  const challengeRef=await createSpeechReviewChallenge(f.projects,root,f.projectId,randomUUID(),changed,f.voice.lineId,f.voice,f.transcript);
  const record=(await f.projects.store.readFresh<Record<string,unknown>>(ref.key)).value;
  const forged=await f.projects.index.immutable(`projects/${f.projectId}/speech-reviews`,{...record,challengeRef});
  expect(forged.sha256).not.toBe(ref.sha256);
  await expect(loadConfirmedSpeechReview(new FileStore(root),f.projectId,forged)).rejects.toThrow('SPEECH_REVIEW_CHANGED');
  expect(canonicalHash((await f.projects.store.readFresh(ref.key)).value)).toBe(ref.sha256);
 }finally{await rm(root,{recursive:true,force:true})}
});

it('preserves the historical listening fact after cancellation while new lookup remains epoch scoped',async()=>{
 const root=await mkdtemp(join(tmpdir(),'vb-review-history-'));
 try{
  const f=await fixture(root),ref=await confirmSpeechReview(f.projects,f.owner,f.projectId,f.challenge,f.messageId);
  await updateJson(f.projects.store,`projects/${f.projectId}/control`,(control:ProjectControl)=>({...control,consentEpoch:control.consentEpoch+1}));
  expect(await loadConfirmedSpeechReview(new FileStore(root),f.projectId,ref)).toMatchObject({ref});
  expect(await findConfirmedSpeechReview(f.projects.store,f.projectId,f.plan,f.plan.lines[0],f.voice,f.transcript)).toBeUndefined();
 }finally{await rm(root,{recursive:true,force:true})}
});
it('exports a trusted narration audit without traversing private confirmation messages or owner credentials',async()=>{
 const root=await mkdtemp(join(tmpdir(),'vb-review-export-'));
 try{
  const f=await fixture(root,'user',true),ref=await confirmSpeechReview(f.projects,f.owner,f.projectId,f.challenge,f.messageId),proof=await loadConfirmedSpeechReview(f.projects.store,f.projectId,ref);
  const prepared=await prepareNarration(f.plan,root,async()=>f.voice),verified=await verifyNarration(f.plan,prepared,root,async()=>f.transcript,async()=>proof);
  const timing=[{lineId:f.voice.lineId,spokenText:f.plan.lines[0].spokenText,displayText:f.plan.lines[0].displayText,expectedAsrText:f.plan.lines[0].expectedAsrText,startSample:0,endSample:48000,voiceSha256:f.voice.wav.sha256,voiceRuntimeDigest:f.voice.runtimeDigest,asrRuntimeDigest:f.transcript.runtimeDigest}];
  const {archiveVerifiedNarration}=await import('@/services/video/audio/narration-package'),revisionId=randomUUID(),narration=await archiveVerifiedNarration(f.projects,root,f.projectId,revisionId,verified,timing);
  const {seedPreviewBundle}=await import('./fixtures/preview-package'),bundle=await seedPreviewBundle(f.projects,{projectId:f.projectId,revisionId,durationSec:20,script:[f.plan.lines[0].spokenText],factTexts:[],previewArtifactSha256:'c'.repeat(64),narration,voiceMetadata:timing});
  await f.projects.store.create(`projects/${f.projectId}/previews/${bundle.previewId}/manifest`,bundle);
  const {prepareFrozenSourceArchive}=await import('@/services/video/exports/source-archive'),archive=await prepareFrozenSourceArchive(f.projects,f.owner,f.projectId,bundle.previewId,root);
  const result=spawnSync('python3',['-c','import sys,io,zipfile,json; z=zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read())); print(json.dumps({n:z.read(n).decode() for n in z.namelist() if n.endswith(".json")}))'],{input:archive.bytes,maxBuffer:4*1024*1024});
  expect(result.status).toBe(0);const files=JSON.parse(result.stdout.toString()) as Record<string,string>,audit=JSON.parse(files[`audit/speech-reviews/${ref.sha256}.json`]);
  expect(audit).toMatchObject({kind:'speech_review_export_audit',authority:'project_owner_explicit_listening_review',decision:'pronunciation_correct',scope:'single_original_wav',voiceSha256:f.voice.wav.sha256,recognizedText:f.transcript.recognizedText,privateConfirmationIncluded:false});
  expect(Object.keys(files).some(key=>key.includes('/messages/')||key.includes('/speech-reviews/'))).toBe(true); // only the audit directory is present
  expect(Object.keys(files).filter(key=>key.includes('/messages/')||key.includes('/speech-reviews/'))).toEqual([`audit/speech-reviews/${ref.sha256}.json`]);
  expect(Object.values(files).join('')).not.toMatch(/ownerKeyHash|sourceMessageRef/);
  const changed=await seedPreviewBundle(f.projects,{projectId:f.projectId,revisionId,durationSec:21,script:[f.plan.lines[0].spokenText],factTexts:[],previewArtifactSha256:'d'.repeat(64),narration,voiceMetadata:timing});
  await f.projects.store.create(`projects/${f.projectId}/previews/${changed.previewId}/manifest`,changed);
  const {loadVerifiedFilmPackage}=await import('@/contracts/video/film-package'),spec=(await f.projects.store.readFresh(changed.filmSpecRef.key)).value;
  await expect(loadVerifiedFilmPackage(f.projects.store,spec,root).then(()=>'accepted')).rejects.toThrow('FILM_NARRATION_CHANGED');
  await expect(prepareFrozenSourceArchive(f.projects,f.owner,f.projectId,changed.previewId,root).then(()=>'accepted')).rejects.toThrow('PREVIEW_PACKAGE_INVALID');
 }finally{await rm(root,{recursive:true,force:true})}
});

it('cold imports ASR without relying on ProjectStore initialization order',()=>{
 const result=spawnSync(process.execPath,['--import','tsx','--input-type=module','-e',"await import('./src/services/video/audio/asr.ts')"],{env:{...process.env,TSX_DISABLE_CACHE:'1'},timeout:15000});
 expect(result.status,result.stderr.toString()).toBe(0);
});
