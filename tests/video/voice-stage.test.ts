import {expect,it,vi} from 'vitest';
// Protocol fixture: synthetic PCM and mocked font metadata are never native QA.
vi.mock('@/services/video/audio/style-font',()=>({readPinnedStyleFont:async(_env:unknown,id:string)=>{const {trustedStyleFont}=await import('@/services/video/media/font-catalog');const f=trustedStyleFont(id);return{id,family:f.family,runtimeDigest:'a'.repeat(64),fontSha256:f.font.sha256,fontBytes:f.font.bytes,licenseSha256:f.licenseFile.sha256,metadataSha256:f.metadata.sha256,charsetSha256:(id==='mashanzheng'?'d':'e').repeat(64),glyphs:new Set('欢迎参加。')}}}));
import {createHash,randomUUID} from 'node:crypto';
import {mkdtemp,mkdir,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {initialUnderstanding} from '@/contracts/video/domain';
import type {ProjectControl} from '@/contracts/video/project';
import {probeTrackWav,probeVoiceWav} from '@/services/video/audio/wav';
import {StoreMissing,updateJson} from '@/services/video/storage/atomic-store';
import {FileStore} from '@/services/video/storage/file-store';
import {ProjectStore} from '@/services/video/storage/project-store';
import {getStyle} from '@/services/video/styles/registry';
import {prepareTreatmentStage} from '@/services/video/preview/treatment-stage';
import {prepareVoiceStage} from '@/services/video/preview/voice-stage';
import {prepareTimingStage} from '@/services/video/preview/timing-stage';
import {prepareNarrationPackageStage} from '@/services/video/preview/narration-package-stage';
import {prepareAudioPlanStage} from '@/services/video/preview/audio-plan-stage';
import {confirmSpeechReview} from '@/services/video/audio/spoken-review';
import {canonicalHash,canonicalJson} from '@/services/video/domain/hash';
import {revisionSeed} from '@/services/video/timeline/seed';
import {prepareFilmPackageStage} from '@/services/video/preview/film-package-stage';
import {prepareAudioExecutionStage} from '@/services/video/preview/audio-execution-stage';
import {loadVerifiedFilmPackage,CaptionPackageSchema,expectedCaptionPackage} from '@/contracts/video/film-package';
import type {FilmSpec} from '@/contracts/video/film';
import {prepareVisualShotStage} from '@/services/video/preview/visual-stage';
import {preparePictureShotStage} from '@/services/video/preview/picture-stage';
import type {MediaJob} from '@/services/video/media/executor';
import {preparePictureSequenceStage} from '@/services/video/preview/picture-sequence-stage';
import {pictureSequenceStageKey,type PictureSequenceInput} from '@/services/video/media/picture-sequence';
import {prepareCompositeStage} from '@/services/video/preview/composite-stage';
import {composeStageKey} from '@/services/video/media/compose';
import {formatSrt} from '@/services/video/audio/subtitles';
import {preparePreviewExcerptStage} from '@/services/video/preview/excerpt-stage';
import {previewExcerptStageKey} from '@/services/video/preview/render-excerpt';
import type {ExcerptSegment} from '@/services/video/preview/excerpt';
import type {AudioPlan} from '@/contracts/video/audio-plan';
import type {AudioPlanStageRecord} from '@/services/video/preview/audio-plan-stage';
import type {VisualStageRecord} from '@/services/video/preview/visual-stage';
import type {VisualShotSource} from '@/contracts/video/visual-shot';

function wav(){
 const data=Buffer.alloc(24000*4);
 for(let index=0;index<24000;index++)data.writeFloatLE(Math.sin(index*0.1)*0.1,index*4);
 const result=Buffer.alloc(44+data.length);result.write('RIFF',0);result.writeUInt32LE(result.length-8,4);result.write('WAVEfmt ',8);
 result.writeUInt32LE(16,16);result.writeUInt16LE(3,20);result.writeUInt16LE(1,22);result.writeUInt32LE(24000,24);result.writeUInt32LE(96000,28);result.writeUInt16LE(4,32);result.writeUInt16LE(32,34);result.write('data',36);result.writeUInt32LE(data.length,40);data.copy(result,44);
 return result;
}

it.each([{model:'Systran/faster-whisper-small',trusted:false,book:false},{model:'Systran/faster-whisper-medium',trusted:false,book:false},{model:'Systran/faster-whisper-medium',trusted:true,book:false},{model:'Systran/faster-whisper-medium',trusted:false,book:true}] as const)('T10/T11 persists frozen voice with $model and trusted=$trusted book=$book through a private excerpt and detects tampering',async({model,trusted,book})=>{
 const root=await mkdtemp(join(tmpdir(),'vb-voice-stage-'));
 try{
  const projects=new ProjectStore(new FileStore(root)),created=await projects.create('owner',{schemaVersion:5,clientCommandId:randomUUID(),clientCreateId:randomUUID()});
  const projectId=created.projectId,revisionId=randomUUID(),operationId=randomUUID(),style=getStyle('crayon-book'),base=initialUnderstanding();
  const assetId=randomUUID(),assetBytes=Buffer.from('# 活动资料\n欢迎参加。\n'),assetSha256=createHash('sha256').update(assetBytes).digest('hex');
  await mkdir(join(root,'assets',projectId),{recursive:true});const assetPath=join(root,'assets',projectId,`${assetId}.bin`);await writeFile(assetPath,assetBytes);
  const analysisRef=await projects.index.immutable(`projects/${projectId}/assets/${assetId}/analysis/${assetSha256}`,{schemaVersion:5,assetId,mime:'text/markdown',sha256:assetSha256,text:assetBytes.toString(),trust:'untrusted_material'});
  const asset={id:assetId,commandId:randomUUID(),bodyHash:'c'.repeat(64),reservationId:randomUUID(),filename:'source.md',declaredBytes:assetBytes.length,declaredMime:'text/markdown',intendedUse:'活动资料',rightsConfirmed:true,status:'ready',expiresAt:new Date(Date.now()+60000).toISOString(),sha256:assetSha256,bytes:assetBytes.length,analysisRef,quotaReserved:true};
  const understanding={...base,briefVersion:1,subject:'活动预告',assetUses:[{assetId,purpose:'活动资料',required:true}],preferences:{...base.preferences,durationSec:20,styleSlug:style.slug,voiceMode:'tts' as const,musicMode:'none' as const}};
  const understandingRef=await projects.index.immutable(`projects/${projectId}/understanding/1`,understanding);
  await updateJson(projects.store,`projects/${projectId}/control`,(c:ProjectControl)=>({...c,briefVersion:1,understandingRef,assets:[asset],phase:'preparing_preview' as const,activeProduction:operationId}));
  const plan={schemaVersion:1,briefVersion:1,styleSlug:style.slug,styleRulesHash:style.rulesHash,durationSec:20,aspect:'16:9',fps:24,summary:'活动预告',options:[{id:'a',concept:'绘图',visualApproach:'蜡笔',soundApproach:'鼓点',tradeoff:'动画多'},{id:'b',concept:'纸页',visualApproach:'翻页',soundApproach:'纸声',tradeoff:'人物少'},{id:'c',concept:'角色',visualApproach:'走路',soundApproach:'脚步',tradeoff:'造型复杂'}],selectedOptionId:'a',selectionReason:'信息清晰',shots:[{id:'shot',startFrame:0,endFrame:480,visualIntent:'活动日期',scriptLine:'欢迎参加。',factIds:[]}],script:['欢迎参加。']};
  const treatmentRef=await prepareTreatmentStage(projects,projectId,revisionId,operationId,0,{decide:async()=>plan,limits:{projectCalls:5,projectInputTokens:200000,projectOutputTokens:20000,dailyCalls:10}});
  const voicePath=join(root,'voice','fixture','narration.wav');let generated=0,recognized=0;
  await expect(prepareVoiceStage(projects,projectId,revisionId,operationId,0,treatmentRef,{root,mustExist:true})).rejects.toThrow('VOICE_STAGE_MISSING');
  const options={root,generate:async(_root:string,job:{lineId:string;language:'zh-CN'|'en';text:string})=>{
   generated++;await mkdir(join(root,'voice','fixture'),{recursive:true});const bytes=wav();await writeFile(voicePath,bytes);
   return{lineId:job.lineId,language:job.language,voice:'zf_001' as const,provider:'kokoro-js' as const,model:'test-runtime',modelLicense:'Apache-2.0' as const,runtimeDigest:'a'.repeat(64),outputPath:voicePath,wav:probeVoiceWav(bytes)};
  },recognize:async(_root:string,voice:{wav:{sha256:string}})=>{
   recognized++;const recognizedText=trusted?'欢迎参家。':'欢迎参加。';return{language:'zh-CN' as const,model,segments:[{text:recognizedText,startMs:0,endMs:700,words:[{text:recognizedText,startMs:0,endMs:700,probability:0.9}]}],voiceSha256:voice.wav.sha256,runtimeDigest:'b'.repeat(64),recognizedText};
  }};
  if(trusted){
   await expect(prepareVoiceStage(projects,projectId,revisionId,operationId,0,treatmentRef,options)).rejects.toThrow('ASR_MISMATCH');
   const keys=await projects.store.listKeys?.(`projects/${projectId}/speech-review-challenges`,1);expect(keys).toHaveLength(1);
   const challenge=(await projects.store.readFresh(keys![0])).value;
   const challengeRef={key:keys![0],sha256:canonicalHash(challenge),bytes:Buffer.byteLength(canonicalJson(challenge)),mime:'application/json'},messageId=randomUUID();
   // Protocol fixture only: synthetic PCM does not establish real pronunciation.
   await projects.archiveMessage(projectId,{id:messageId,ordinal:1,role:'user',text:'读音正确，确认这句试听复核',status:'completed',contentVersion:1,clientMessageId:messageId});
   await confirmSpeechReview(projects,'owner',projectId,challengeRef,messageId);
  }
  const first=await prepareVoiceStage(projects,projectId,revisionId,operationId,0,treatmentRef,options);
  expect(first.verifiedRef.sha256).toMatch(/^[a-f0-9]{64}$/);
  expect((await projects.store.readFresh<{lines:Array<{asrStatus:string}>}>(first.verifiedRef.key)).value.lines[0].asrStatus).toBe(trusted?'trusted_review':'pass');
  expect(await prepareVoiceStage(projects,projectId,revisionId,operationId,0,treatmentRef,options)).toEqual(first);
  expect([generated,recognized]).toEqual([trusted?2:1,trusted?2:1]);
  const trackPath=join(root,'audio','fixture','track.wav');let mixed=0,fontReads=0;
  const trackBytes=Buffer.alloc(44+960000*4);trackBytes.write('RIFF',0);trackBytes.writeUInt32LE(trackBytes.length-8,4);trackBytes.write('WAVEfmt ',8);trackBytes.writeUInt32LE(16,16);trackBytes.writeUInt16LE(3,20);trackBytes.writeUInt16LE(1,22);trackBytes.writeUInt32LE(48000,24);trackBytes.writeUInt32LE(192000,28);trackBytes.writeUInt16LE(4,32);trackBytes.writeUInt16LE(32,34);trackBytes.write('data',36);trackBytes.writeUInt32LE(960000*4,40);for(let index=0;index<48000;index++)trackBytes.writeFloatLE(Math.sin(index*0.1)*0.1,44+index*4);
  const timingOptions={root,buildTrack:async()=>{mixed++;await mkdir(join(root,'audio','fixture'),{recursive:true});await writeFile(trackPath,trackBytes);return{outputPath:trackPath,runtimeDigest:'a'.repeat(64),wav:probeTrackWav(trackBytes,960000,false),kind:'narration_only' as const,qaStatus:'not_checked' as const}},readFont:async()=>{fontReads++;return{family:'Noto Sans CJK SC' as const,runtimeDigest:'a'.repeat(64),charsetSha256:'d'.repeat(64),glyphs:new Set(Array.from('欢迎参加。'))}}};
  await expect(prepareTimingStage(projects,projectId,revisionId,operationId,0,treatmentRef,{root,mustExist:true})).rejects.toThrow('TIMING_STAGE_MISSING');
  const timing=await prepareTimingStage(projects,projectId,revisionId,operationId,0,treatmentRef,book?{...timingOptions,readFont:undefined,env:{VIDEO_MEDIA_IMAGE_REF:'sha256:'+'a'.repeat(64),VIDEO_MEDIA_RUNTIME_DIGEST:'a'.repeat(64),VIDEO_MEDIA_TIMEOUT_SECONDS:'60'}}:timingOptions);
  expect((await projects.store.readFresh<{totalFrames:number;narration:unknown[];captions:unknown[]}>(timing.draftRef.key)).value).toMatchObject({totalFrames:480,narration:[{}],captions:[{}]});
  expect(await prepareTimingStage(projects,projectId,revisionId,operationId,0,treatmentRef,timingOptions)).toEqual(timing);
  expect([mixed,fontReads]).toEqual([1,book?0:1]);
  await expect(prepareNarrationPackageStage(projects,projectId,revisionId,operationId,0,treatmentRef,{root,mustExist:true})).rejects.toThrow('NARRATION_PACKAGE_MISSING');
  const narrationPackage=await prepareNarrationPackageStage(projects,projectId,revisionId,operationId,0,treatmentRef,{root});
  expect(await prepareNarrationPackageStage(projects,projectId,revisionId,operationId,0,treatmentRef,{root,mustExist:true})).toEqual(narrationPackage);
  expect([generated,recognized,mixed]).toEqual([trusted?2:1,trusted?2:1,1]);
  await expect(prepareAudioPlanStage(projects,projectId,revisionId,operationId,0,treatmentRef,{root,mustExist:true})).rejects.toThrow('AUDIO_STAGE_MISSING');
  let audioCalls=0;
  const audioOptions={root,limits:{projectCalls:5,projectInputTokens:200000,projectOutputTokens:40000,dailyCalls:10},decide:async()=>{audioCalls++;return{schemaVersion:1,briefVersion:1,styleSlug:style.slug,styleRulesHash:style.rulesHash,timingDraftHash:timing.draftRef.sha256,seed:revisionSeed(projectId,revisionId),sections:[{id:'whole',startFrame:0,endFrame:480,bpm:120,beatsPerBar:4,beatUnit:4,barOffset:0}],cues:[],sources:[],music:[],foley:[],intentionalSilenceRanges:[{startSample:0,endSample:960000,buses:['music','foley']}],mix:{targetLufs:-14,toleranceLu:1,maxTruePeakDbtp:-1.2,voiceGainDb:0,duck:{thresholdDb:-24,ratio:4,attackMs:10,releaseMs:180}},reasoning:'此测试明确无配乐与拟音，只有旁白；节拍网格是声明的计时信息。'}}};
  const audio=await prepareAudioPlanStage(projects,projectId,revisionId,operationId,0,treatmentRef,audioOptions);
  expect(audio.executionStatus).toBe('not_started');
  expect(await prepareAudioPlanStage(projects,projectId,revisionId,operationId,0,treatmentRef,{root,mustExist:true})).toEqual(audio);expect(audioCalls).toBe(1);
  const visualHtml='<!doctype html><html><meta charset="utf-8"><canvas id="c" width="1920" height="1080"></canvas><script>const c=document.getElementById("c"),x=c.getContext("2d");window.render=t=>{x.fillStyle="#f4efe3";x.fillRect(0,0,1920,1080);x.fillText("欢迎参加",100+10*Math.sin(t),200)};window.READY=true;</script></html>';
  let visualCalls=0;const visualOptions={root,limits:{projectCalls:5,projectInputTokens:200000,projectOutputTokens:40000,dailyCalls:10},decide:async()=>{visualCalls++;return{schemaVersion:1,briefVersion:1,styleSlug:style.slug,styleRulesHash:style.rulesHash,timingDraftHash:timing.draftRef.sha256,shotId:'shot',startFrame:0,endFrame:480,factIds:[],assetIds:[],sourceHtml:visualHtml,seed:revisionSeed(projectId,revisionId),direction:{purpose:'日期展示',framing:'全画幅二维画布',camera:'固定画布坐标',actorIds:[]}}}};
  await expect(prepareVisualShotStage(projects,projectId,revisionId,operationId,0,treatmentRef,'shot',{root,mustExist:true})).rejects.toThrow('VISUAL_STAGE_MISSING');
  await expect(prepareVisualShotStage(projects,projectId,revisionId,operationId,0,treatmentRef,'shot',{root,env:{VIDEO_DATA_DIR:root}})).rejects.toThrow('GENERATION_DISABLED');
  const visual=await prepareVisualShotStage(projects,projectId,revisionId,operationId,0,treatmentRef,'shot',visualOptions);
  expect(visual.runtimeStatus).toBe('not_checked');
  expect((await projects.store.readFresh<{sourceHtml:string}>(visual.sourceRef.key)).value.sourceHtml).toBe(visualHtml);
  expect(await prepareVisualShotStage(projects,projectId,revisionId,operationId,0,treatmentRef,'shot',visualOptions)).toEqual(visual);
  expect(await prepareVisualShotStage(projects,projectId,revisionId,operationId,0,treatmentRef,'shot',{root,mustExist:true})).toEqual(visual);
  expect(visualCalls).toBe(1);
  const packageEnv={VIDEO_MEDIA_IMAGE_REF:`sha256:${'a'.repeat(64)}`,VIDEO_MEDIA_RUNTIME_DIGEST:'a'.repeat(64),VIDEO_MEDIA_TIMEOUT_SECONDS:'120'};
  await expect(prepareFilmPackageStage(projects,projectId,revisionId,operationId,0,treatmentRef,{root,env:packageEnv,mustExist:true})).rejects.toThrow('FILM_PACKAGE_MISSING');
  const revisionPrefix=`projects/${projectId}/revisions/${revisionId}/`;
  const audioData=(await projects.store.readFresh<AudioPlan>(audio.planRef.key)).value;
  const unappliedGainRef=await projects.index.immutable(`${revisionPrefix}audio-plan`,{...audioData,mix:{...audioData.mix,voiceGainDb:-3}});
  await updateJson(projects.store,`${revisionPrefix}audio-plan-stage`,(r:AudioPlanStageRecord)=>({...r,planRef:unappliedGainRef}));
  await expect(prepareAudioExecutionStage(projects,projectId,revisionId,operationId,0,treatmentRef,{root,env:packageEnv,mustExist:true})).rejects.toThrow('AUDIO_EXECUTION_MISSING');
  await expect(prepareFilmPackageStage(projects,projectId,revisionId,operationId,0,treatmentRef,{root,env:packageEnv})).rejects.toThrow('FILM_AUDIO_EXECUTION_NOT_READY');
  await expect(projects.store.readFresh(`${revisionPrefix}film-package-stage`)).rejects.toBeInstanceOf(StoreMissing);
  await updateJson(projects.store,`${revisionPrefix}audio-plan-stage`,()=>audio);
  const unappliedFoleyRef=await projects.index.immutable(`${revisionPrefix}audio-plan`,{...audioData,cues:[{id:'tap',sourceShotId:'shot',requestedTimeUs:0,alignmentPolicy:'audio'}],sources:[{id:'wood',kind:'synthesis',description:'敲击',material:'木材',recipe:{instrument:'pluck',frequencyHz:240,attackMs:2,releaseMs:100}}],foley:[{eventId:'tap',cueId:'tap',source:'wood',durationSamples:48000,gainDb:-12,pan:0}],intentionalSilenceRanges:[{startSample:0,endSample:960000,buses:['music']}]});
  await updateJson(projects.store,`${revisionPrefix}audio-plan-stage`,(r:AudioPlanStageRecord)=>({...r,planRef:unappliedFoleyRef}));
  await expect(prepareFilmPackageStage(projects,projectId,revisionId,operationId,0,treatmentRef,{root,env:packageEnv})).rejects.toThrow('FILM_AUDIO_EXECUTION_NOT_READY');
  await updateJson(projects.store,`${revisionPrefix}audio-plan-stage`,()=>audio);
  const visualData=(await projects.store.readFresh<VisualShotSource>(visual.sourceRef.key)).value;
  const legacySource={...visualData};delete legacySource.direction;delete legacySource.seed;
  const incompleteRef=await projects.index.immutable(visual.sourceRef.key.slice(0,visual.sourceRef.key.lastIndexOf('/')),legacySource);
  const visualKey=`${revisionPrefix}visual/${createHash('sha256').update(JSON.stringify({shotId:'shot'})).digest('hex')}`;
  await updateJson(projects.store,visualKey,(r:VisualStageRecord)=>({...r,sourceRef:incompleteRef}));
  await expect(prepareFilmPackageStage(projects,projectId,revisionId,operationId,0,treatmentRef,{root,env:packageEnv,readFont:timingOptions.readFont})).rejects.toThrow('FILM_VISUAL_SOURCE_INCOMPLETE');
  await updateJson(projects.store,visualKey,()=>visual);
  await expect(prepareFilmPackageStage(projects,projectId,revisionId,operationId,0,treatmentRef,{root,env:{...packageEnv,VIDEO_MEDIA_IMAGE_REF:`sha256:${'b'.repeat(64)}`,VIDEO_MEDIA_RUNTIME_DIGEST:'b'.repeat(64)}})).rejects.toThrow('FILM_RUNTIME_CHANGED');
  if(!book) await expect(prepareFilmPackageStage(projects,projectId,revisionId,operationId,0,treatmentRef,{root,env:packageEnv,readFont:async()=>({...await timingOptions.readFont(),glyphs:new Set()})})).rejects.toThrow('FILM_FONT_CHANGED');
  const filmPackage=await prepareFilmPackageStage(projects,projectId,revisionId,operationId,0,treatmentRef,{root,env:packageEnv,readFont:timingOptions.readFont});
  expect(filmPackage.qualityStatus).toBe('semantic_not_checked');
  expect(await prepareFilmPackageStage(projects,projectId,revisionId,operationId,0,treatmentRef,{root,env:packageEnv,mustExist:true,readFont:timingOptions.readFont})).toEqual(filmPackage);
  const spec=(await projects.store.readFresh<FilmSpec>(filmPackage.filmSpecRef.key)).value;
  const frozen=await loadVerifiedFilmPackage(projects.store,spec,root);
  const captionRef=frozen.sourceManifest.captionStyles[0].styleRef;
  const captionPackage=CaptionPackageSchema.parse((await projects.store.readFresh(captionRef.key)).value);
  expect(captionPackage.schemaVersion).toBe(book?4:2);
  expect(captionPackage.profiles.preview).toEqual(captionPackage.profiles.full);
  await expect(loadVerifiedFilmPackage(projects.store,{...spec,qualityPolicyVersion:'v5.1-package-1'},root)).rejects.toThrow('FILM_CAPTION_CHANGED');
  if(book){
   expect(captionPackage.font.family).toBe('Crayon Book Clear Handwriting');
   expect(()=>expectedCaptionPackage(captionPackage.font,spec.output,'v5.1-package-3-book-captions')).toThrow('FILM_CAPTION_CHANGED');
   expect(()=>expectedCaptionPackage(captionPackage.font,spec.output,'v5.1-package-1')).toThrow('FILM_CAPTION_CHANGED');
   expect(()=>expectedCaptionPackage(captionPackage.font,spec.output,'v5.1-package-2-caption-coordinates')).toThrow('FILM_CAPTION_CHANGED');
   expect(frozen.timeline.captions[0].stableReadableStartFrame).toBe(frozen.timeline.captions[0].startFrame+9);
  }else{
  const legacyCaptionRef=await projects.index.immutable(`${revisionPrefix}caption-styles`,expectedCaptionPackage(captionPackage.font,spec.output,'v5.1-package-1'));
  const legacySourceRef=await projects.index.immutable(`${revisionPrefix}source-manifest`,{...frozen.sourceManifest,captionStyles:[{...frozen.sourceManifest.captionStyles[0],styleRef:legacyCaptionRef}]});
  const legacySpec={...spec,sourceManifestRef:legacySourceRef,qualityPolicyVersion:'v5.1-package-1'};
  await expect(loadVerifiedFilmPackage(projects.store,legacySpec,root)).resolves.toMatchObject({filmSpec:legacySpec});
  await expect(loadVerifiedFilmPackage(projects.store,{...legacySpec,qualityPolicyVersion:spec.qualityPolicyVersion},root)).rejects.toThrow('FILM_CAPTION_CHANGED');
  const legacySpecRef=await projects.index.immutable(`${revisionPrefix}film`,legacySpec),legacyStage={...filmPackage,filmSpecRef:legacySpecRef};
  await updateJson(projects.store,`${revisionPrefix}film-package-v2-stage`,()=>legacyStage);
  expect(await prepareFilmPackageStage(projects,projectId,revisionId,operationId,0,treatmentRef,{root,env:packageEnv,mustExist:true,readFont:timingOptions.readFont})).toEqual(legacyStage);
  await updateJson(projects.store,`${revisionPrefix}film-package-v2-stage`,()=>filmPackage);
  }
  await expect(loadVerifiedFilmPackage(projects.store,{...spec,qualityPolicyVersion:'v1'},root)).rejects.toThrow('FILM_POLICY_UNSUPPORTED');
  expect(spec).toMatchObject({seed:revisionSeed(projectId,revisionId),output:{width:1920,height:1080,totalFrames:480}});
  expect(frozen.timeline.narration[0].audioRef.mime).toBe('audio/wav');expect(frozen.timeline.shots[0].camera).toBe('固定画布坐标');
  expect(frozen.audioManifest.planRef).toEqual(audio.planRef);
  expect(frozen.assetManifest.assets[0].originalRef?.sha256).toBe(assetSha256);
  await writeFile(assetPath,Buffer.from('# 篡改活动资料\n'));
  await expect(loadVerifiedFilmPackage(projects.store,spec,root)).rejects.toThrow('FILM_ASSET_INVALID');
  await writeFile(assetPath,assetBytes);
  const badTimelineRef=await projects.index.immutable(`projects/${projectId}/revisions/${revisionId}/timeline`,{...frozen.timeline,sections:[{...frozen.timeline.sections[0],bpm:100}]});
  await expect(loadVerifiedFilmPackage(projects.store,{...spec,timelineRef:badTimelineRef},root)).rejects.toThrow('FILM_AUDIO_PLAN_CHANGED');
  const badCameraRef=await projects.index.immutable(`projects/${projectId}/revisions/${revisionId}/timeline`,{...frozen.timeline,shots:[{...frozen.timeline.shots[0],camera:'另一条摄影机轨迹'}]});
  await expect(loadVerifiedFilmPackage(projects.store,{...spec,timelineRef:badCameraRef},root)).rejects.toThrow('FILM_VISUAL_SOURCE_CHANGED');
  const sourceModule=frozen.sourceManifest.modules[0],sourceCode=(await projects.store.readFresh<{html:string}>(sourceModule.sourceRef.key)).value;
  const strippedModule=await projects.index.immutable(`${revisionPrefix}source-modules`,{html:sourceCode.html});
  const strippedManifest=await projects.index.immutable(`${revisionPrefix}source-manifest`,{...frozen.sourceManifest,modules:[{...sourceModule,sourceRef:strippedModule}]});
  await expect(loadVerifiedFilmPackage(projects.store,{...spec,sourceManifestRef:strippedManifest},root)).rejects.toThrow('FILM_VISUAL_SOURCE_CHANGED');
  const changedCaption=await projects.index.immutable(`${revisionPrefix}timeline`,{...frozen.timeline,captions:[{...frozen.timeline.captions[0],endFrame:frozen.timeline.captions[0].endFrame+1}]});
  await expect(loadVerifiedFilmPackage(projects.store,{...spec,timelineRef:changedCaption},root)).rejects.toThrow('FILM_CAPTION_CHANGED');
  const silentDrop=await projects.index.immutable(`${revisionPrefix}audio-manifest`,{...frozen.audioManifest,sources:[]});
  await expect(loadVerifiedFilmPackage(projects.store,{...spec,audioManifestRef:silentDrop},root)).rejects.toThrow('FILM_NARRATION_CHANGED');
  let submitted:MediaJob|undefined,qaHash='e'.repeat(64),renderCalls=0;
  await expect(preparePictureShotStage(projects,projectId,revisionId,operationId,0,treatmentRef,'shot',{root,mustExist:true,env:{VIDEO_MEDIA_IMAGE_REF:`sha256:${'a'.repeat(64)}`,VIDEO_MEDIA_RUNTIME_DIGEST:'a'.repeat(64),VIDEO_MEDIA_TIMEOUT_SECONDS:'120'}})).rejects.toThrow('PICTURE_STAGE_MISSING');
  const pictureOptions={root,env:{VIDEO_DATA_DIR:root,VIDEO_MEDIA_IMAGE_REF:`sha256:${'a'.repeat(64)}`,VIDEO_MEDIA_RUNTIME_DIGEST:'a'.repeat(64),VIDEO_MEDIA_TIMEOUT_SECONDS:'120'},pollMs:1,
   executor:{submit:async(job:MediaJob)=>{submitted=job;renderCalls++;return{containerName:'test',containerId:'test',stageKey:job.stageKey,runtimeDigest:job.runtimeDigest}},inspect:async()=>({status:'succeeded' as const,outputs:['output/picture.mp4']}),cancel:async()=>({status:'cancelled' as const})},
   qa:async(_dir:string,_image:string,_path:string,expected:{width:number;height:number;durationSec:number;fps:number;audio:boolean})=>({result:'pass' as const,sha256:qaHash,bytes:1234,frames:Math.round(expected.durationSec*expected.fps),...expected})};
  const picture=await preparePictureShotStage(projects,projectId,revisionId,operationId,0,treatmentRef,'shot',pictureOptions);
  expect(submitted).toMatchObject({startFrame:0,endFrame:480,logicalWidth:1920,logicalHeight:1080,outputWidth:1920,outputHeight:1080,fps:24});
  expect(submitted?.seed).toBe(revisionSeed(projectId,revisionId));
  expect(picture.technicalQa).toMatchObject({durationSec:20,sha256:'e'.repeat(64)});
  expect(await preparePictureShotStage(projects,projectId,revisionId,operationId,0,treatmentRef,'shot',pictureOptions)).toEqual(picture);
  expect(renderCalls).toBe(1);
  const previewShot=await preparePictureShotStage(projects,projectId,revisionId,operationId,0,treatmentRef,'shot',{...pictureOptions,profile:'preview'});
  expect(previewShot.profile).toBe('preview');
  expect(submitted).toMatchObject({logicalWidth:1920,logicalHeight:1080,outputWidth:1280,outputHeight:720});
  let assemblyCalls=0;
  const sequenceOptions={root,env:pictureOptions.env,qa:pictureOptions.qa,assemble:async(_root:string,input:PictureSequenceInput)=>{assemblyCalls++;const stageKey=pictureSequenceStageKey(input);return{stageKey,outputPath:join(root,'picture-sequence',stageKey,'output','picture.mp4'),technicalQa:{result:'pass' as const,sha256:qaHash,bytes:1234,width:1920,height:1080,durationSec:20,fps:24,frames:480,audio:false},totalFrames:480}}};
  const sequence=await preparePictureSequenceStage(projects,projectId,revisionId,operationId,0,treatmentRef,sequenceOptions);
  expect(sequence.totalFrames).toBe(480);
  expect(await preparePictureSequenceStage(projects,projectId,revisionId,operationId,0,treatmentRef,sequenceOptions)).toEqual(sequence);
  expect(assemblyCalls).toBe(1);
  let compositionCalls=0,postMixCalls=0,filmHash='f'.repeat(64);
  const compositeOptions={root,env:pictureOptions.env,pictureQa:pictureOptions.qa,readFont:timingOptions.readFont,
   filmQa:async(_dir:string,_image:string,_path:string,expected:{width:number;height:number;durationSec:number;fps:number;audio:boolean})=>({result:'pass' as const,sha256:filmHash,bytes:4321,frames:Math.round(expected.durationSec*expected.fps),...expected}),
   compose:async(_root:string,_pictureDir:string,track:{wav:{sha256:string;silence:boolean}},cues:Parameters<typeof formatSrt>[0],captionStyle:Parameters<typeof composeStageKey>[0]['style'],spec:Parameters<typeof composeStageKey>[0]['spec'])=>{
    compositionCalls++;const srt=formatSrt(cues),stageKey=composeStageKey({pictureSha256:qaHash,trackSha256:track.wav.sha256,trackSilent:track.wav.silence,srtSha256:srt?createHash('sha256').update(srt).digest('hex'):null,style:captionStyle,runtimeDigest:'a'.repeat(64),spec});
    return{stageKey,outputPath:join(root,'composition',stageKey,'output','final.mp4'),subtitlesPath:join(root,'composition',stageKey,'subtitles.srt'),technicalQa:{result:'pass' as const,sha256:filmHash,bytes:4321,width:1920,height:1080,durationSec:20,fps:24,frames:480,audio:true},loudness:{status:'pass' as const,filmSha256:filmHash,runtimeDigest:'a'.repeat(64),integratedLufs:-14,truePeakDbtp:-1.5,targetLufs:-14,toleranceLu:1,maxTruePeakDbtp:-1.2},qaStatus:'semantic_not_checked' as const};
   },postMix:async(_root:string,film:{sha256:string})=>{postMixCalls++;return{status:'pass' as const,filmSha256:film.sha256,lines:[{lineId:'line_1',recognizedText:'欢迎参加。',sourceSha256:'b'.repeat(64),asrRuntimeDigest:'b'.repeat(64),wordCount:1,status:trusted?'trusted_review' as const:'pass' as const,...(trusted?{speechReviewRef:{key:`projects/${projectId}/postmix-reviews/${'b'.repeat(64)}`,sha256:'b'.repeat(64),bytes:100,mime:'application/json'}}:{})}]}}};
  const composite=await prepareCompositeStage(projects,projectId,revisionId,operationId,0,treatmentRef,compositeOptions);
  expect(composite.qualityStatus).toBe('semantic_not_checked');
  expect(composite.narrationPackageSha256).toBe(narrationPackage.packageRef.sha256);
  expect(composite.audioPlanSha256).toBe(audio.planRef.sha256);
  expect(composite.audioExecutionSha256).toBeNull();
  expect(await prepareCompositeStage(projects,projectId,revisionId,operationId,0,treatmentRef,compositeOptions)).toEqual(composite);
  const compositeKey=`projects/${projectId}/revisions/${revisionId}/composite-v4/full`;
  await updateJson(projects.store,compositeKey,()=>({...composite,postMix:{...composite.postMix,lines:[]}}));
  await expect(prepareCompositeStage(projects,projectId,revisionId,operationId,0,treatmentRef,compositeOptions)).rejects.toThrow('COMPOSITE_POSTMIX_CHANGED');
  expect([compositionCalls,postMixCalls]).toEqual([1,3]);
  if(trusted){
   const downgraded={...composite,postMix:{...composite.postMix,lines:composite.postMix.lines.map(line=>{const {speechReviewRef,...rest}=line;void speechReviewRef;return{...rest,status:'pass' as const}})}};
   await updateJson(projects.store,compositeKey,()=>downgraded);
   await expect(prepareCompositeStage(projects,projectId,revisionId,operationId,0,treatmentRef,compositeOptions)).rejects.toThrow('COMPOSITE_POSTMIX_CHANGED');
  }
  await updateJson(projects.store,compositeKey,()=>composite);
  for(const frozenFilm of [{outputPath:composite.outputPath,sha256:'a'.repeat(64),durationMs:20000,technicalQa:'pass' as const},{outputPath:composite.outputPath+'/other',sha256:filmHash,durationMs:20000,technicalQa:'pass' as const},{outputPath:composite.outputPath,sha256:filmHash,durationMs:21000,technicalQa:'pass' as const}]){
   await expect(prepareCompositeStage(projects,projectId,revisionId,operationId,0,treatmentRef,{...compositeOptions,frozenFilm})).rejects.toThrow('FROZEN_PREVIEW_CHANGED');
  }
  const segments:ExcerptSegment[]=[{previewStartMs:0,previewEndMs:5000,sourceStartMs:0,sourceEndMs:5000,shotId:'shot'},{previewStartMs:5000,previewEndMs:7000,sourceStartMs:10000,sourceEndMs:12000,shotId:'shot'},{previewStartMs:7000,previewEndMs:9000,sourceStartMs:16000,sourceEndMs:18000,shotId:'shot'}];
  let excerptCalls=0,previewSha='c'.repeat(64);
  const excerptOptions={root,profile:'full' as const,env:pictureOptions.env,composite:compositeOptions,
   qa:async(_dir:string,_image:string,_path:string,expected:{width:number;height:number;durationSec:number;fps:number;audio:boolean})=>({result:'pass' as const,sha256:previewSha,bytes:2345,frames:Math.round(expected.durationSec*expected.fps),...expected}),
   render:async(input:{root:string;sourceSha256:string;segments:ExcerptSegment[];width:number;height:number;fps:24|30|60})=>{excerptCalls++;const stageKey=previewExcerptStageKey({fullFilmSha256:input.sourceSha256,segments:input.segments,width:input.width,height:input.height,fps:input.fps,runtimeDigest:'a'.repeat(64)});return{stageKey,outputPath:join(root,'preview',stageKey,'output','preview.mp4'),sha256:previewSha,bytes:2345,durationMs:9000,sourceFilmSha256:input.sourceSha256,excerptMap:segments,audioChannels:1 as const,technicalQa:{result:'pass' as const,sha256:previewSha,bytes:2345,width:1920,height:1080,durationSec:9,fps:24,frames:216,audio:true,audioChannels:1}}},
   stageArtifact:async(_projects:ProjectStore,_root:string,_projectId:string,revision:string,artifactId:string,preview:{sha256:string;bytes:number})=>({id:artifactId,revisionId:revision,objectRef:{key:`projects/${projectId}/artifacts/${artifactId}/files/preview.mp4`,sha256:preview.sha256,bytes:preview.bytes,mime:'video/mp4'},qaPassed:true,uploaded:true,filename:'preview.mp4',sourceFilmSha256:filmHash,excerptStageKey:'test'})};
  const excerpt=await preparePreviewExcerptStage(projects,projectId,revisionId,operationId,0,treatmentRef,segments,excerptOptions);
  expect(excerpt.durationMs).toBe(9000);
  expect(await preparePreviewExcerptStage(projects,projectId,revisionId,operationId,0,treatmentRef,segments,excerptOptions)).toEqual(excerpt);
  expect(excerptCalls).toBe(1);
  await expect(preparePreviewExcerptStage(projects,projectId,revisionId,operationId,0,treatmentRef,[{...segments[0],shotId:'wrong'},...segments.slice(1)],excerptOptions)).rejects.toThrow('EXCERPT_SHOT_CHANGED');
  await expect(preparePreviewExcerptStage(projects,projectId,revisionId,operationId,0,treatmentRef,[segments[0],{...segments[1],sourceStartMs:11000,sourceEndMs:13000},segments[2]],excerptOptions)).rejects.toThrow('PREVIEW_STAGE_CONFLICT');
  const cutSpeech:ExcerptSegment[]=[{previewStartMs:0,previewEndMs:500,sourceStartMs:0,sourceEndMs:500,shotId:'shot'},{previewStartMs:500,previewEndMs:7000,sourceStartMs:10000,sourceEndMs:16500,shotId:'shot'},{previewStartMs:7000,previewEndMs:9000,sourceStartMs:17000,sourceEndMs:19000,shotId:'shot'}];
  await expect(preparePreviewExcerptStage(projects,projectId,revisionId,operationId,0,treatmentRef,cutSpeech,excerptOptions)).rejects.toThrow('EXCERPT_SPEECH_CUT');
  previewSha='d'.repeat(64);
  await expect(preparePreviewExcerptStage(projects,projectId,revisionId,operationId,0,treatmentRef,segments,excerptOptions)).rejects.toThrow('PREVIEW_OUTPUT_CHANGED');
  filmHash='e'.repeat(64);
  await expect(prepareCompositeStage(projects,projectId,revisionId,operationId,0,treatmentRef,compositeOptions)).rejects.toThrow('COMPOSITE_OUTPUT_CHANGED');
  qaHash='f'.repeat(64);
  await expect(preparePictureShotStage(projects,projectId,revisionId,operationId,0,treatmentRef,'shot',pictureOptions)).rejects.toThrow('PICTURE_OUTPUT_CHANGED');
  const archivedSource=await projects.store.readFresh<{sourceHtml:string}>(visual.sourceRef.key);
  await projects.store.cas(visual.sourceRef.key,archivedSource.etag,{...archivedSource.value,sourceHtml:'tampered'});
  await expect(prepareVisualShotStage(projects,projectId,revisionId,operationId,0,treatmentRef,'shot',visualOptions)).rejects.toThrow('VISUAL_REF_CHANGED');
  await writeFile(trackPath,Buffer.from('tampered'));
  await expect(prepareTimingStage(projects,projectId,revisionId,operationId,0,treatmentRef,timingOptions)).rejects.toThrow('TIMING_TRACK_CHANGED');
  await writeFile(voicePath,Buffer.from('tampered'));
  await expect(prepareVoiceStage(projects,projectId,revisionId,operationId,0,treatmentRef,options)).rejects.toThrow('VOICE_SOURCE_CHANGED');
  const changedRevision=randomUUID();
  const changedTreatment=await prepareTreatmentStage(projects,projectId,changedRevision,operationId,0,{decide:async()=>plan,limits:{projectCalls:5,projectInputTokens:200000,projectOutputTokens:40000,dailyCalls:10}});
  await expect(prepareVoiceStage(projects,projectId,changedRevision,operationId,0,changedTreatment,{...options,generate:async(dir,job)=>{
   const voice=await options.generate(dir,job);
   await updateJson(projects.store,`projects/${projectId}/control`,(c:ProjectControl)=>({...c,consentEpoch:1}));
   return voice;
  }})).rejects.toThrow('PREVIEW_STALE');
  await expect(projects.store.readFresh(`projects/${projectId}/revisions/${changedRevision}/voice-stage`)).rejects.toBeInstanceOf(StoreMissing);
  await expect(prepareNarrationPackageStage(projects,projectId,revisionId,operationId,0,treatmentRef,{root,mustExist:true})).rejects.toThrow('PREVIEW_STALE');
 }finally{await rm(root,{recursive:true,force:true})}
},15000);
