import {expect,it} from 'vitest';
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

function wav(){
 const data=Buffer.alloc(24000*4);
 for(let index=0;index<24000;index++)data.writeFloatLE(Math.sin(index*0.1)*0.1,index*4);
 const result=Buffer.alloc(44+data.length);result.write('RIFF',0);result.writeUInt32LE(result.length-8,4);result.write('WAVEfmt ',8);
 result.writeUInt32LE(16,16);result.writeUInt16LE(3,20);result.writeUInt16LE(1,22);result.writeUInt32LE(24000,24);result.writeUInt32LE(96000,28);result.writeUInt16LE(4,32);result.writeUInt16LE(32,34);result.write('data',36);result.writeUInt32LE(data.length,40);data.copy(result,44);
 return result;
}

it('T10 persists real voice bytes and verified ASR timings for a frozen treatment, then detects tampering',async()=>{
 const root=await mkdtemp(join(tmpdir(),'vb-voice-stage-'));
 try{
  const projects=new ProjectStore(new FileStore(root)),created=await projects.create('owner',{schemaVersion:5,clientCommandId:randomUUID(),clientCreateId:randomUUID()});
  const projectId=created.projectId,revisionId=randomUUID(),operationId=randomUUID(),style=getStyle('crayon-book'),base=initialUnderstanding();
  const understanding={...base,briefVersion:1,subject:'活动预告',preferences:{...base.preferences,durationSec:20,styleSlug:style.slug,voiceMode:'tts' as const}};
  const understandingRef=await projects.index.immutable(`projects/${projectId}/understanding/1`,understanding);
  await updateJson(projects.store,`projects/${projectId}/control`,(c:ProjectControl)=>({...c,briefVersion:1,understandingRef,phase:'preparing_preview' as const,activeProduction:operationId}));
  const plan={schemaVersion:1,briefVersion:1,styleSlug:style.slug,styleRulesHash:style.rulesHash,durationSec:20,aspect:'16:9',fps:24,summary:'活动预告',options:[{id:'a',concept:'绘图',visualApproach:'蜡笔',soundApproach:'鼓点',tradeoff:'动画多'},{id:'b',concept:'纸页',visualApproach:'翻页',soundApproach:'纸声',tradeoff:'人物少'},{id:'c',concept:'角色',visualApproach:'走路',soundApproach:'脚步',tradeoff:'造型复杂'}],selectedOptionId:'a',selectionReason:'信息清晰',shots:[{id:'shot',startFrame:0,endFrame:480,visualIntent:'活动日期',scriptLine:'欢迎参加。',factIds:[]}],script:['欢迎参加。']};
  const treatmentRef=await prepareTreatmentStage(projects,projectId,revisionId,operationId,0,{decide:async()=>plan,limits:{projectCalls:5,projectInputTokens:200000,projectOutputTokens:20000,dailyCalls:10}});
  const voicePath=join(root,'voice','fixture','narration.wav');let generated=0,recognized=0;
  await expect(prepareVoiceStage(projects,projectId,revisionId,operationId,0,treatmentRef,{root,mustExist:true})).rejects.toThrow('VOICE_STAGE_MISSING');
  const options={root,generate:async(_root:string,job:{lineId:string;language:'zh-CN'|'en';text:string})=>{
   generated++;await mkdir(join(root,'voice','fixture'),{recursive:true});const bytes=wav();await writeFile(voicePath,bytes);
   return{lineId:job.lineId,language:job.language,voice:'zf_001' as const,provider:'kokoro-js' as const,model:'test-runtime',modelLicense:'Apache-2.0' as const,runtimeDigest:'a'.repeat(64),outputPath:voicePath,wav:probeVoiceWav(bytes)};
  },recognize:async(_root:string,voice:{wav:{sha256:string}})=>{
   recognized++;return{language:'zh-CN' as const,model:'Systran/faster-whisper-small' as const,segments:[{text:'欢迎参加。',startMs:0,endMs:700,words:[{text:'欢迎参加',startMs:0,endMs:700,probability:0.9}]}],voiceSha256:voice.wav.sha256,runtimeDigest:'b'.repeat(64),recognizedText:'欢迎参加。'};
  }};
  const first=await prepareVoiceStage(projects,projectId,revisionId,operationId,0,treatmentRef,options);
  expect(first.verifiedRef.sha256).toMatch(/^[a-f0-9]{64}$/);
  expect((await projects.store.readFresh<{lines:Array<{asrStatus:string}>}>(first.verifiedRef.key)).value.lines[0].asrStatus).toBe('pass');
  expect(await prepareVoiceStage(projects,projectId,revisionId,operationId,0,treatmentRef,options)).toEqual(first);
  expect([generated,recognized]).toEqual([1,1]);
  const trackPath=join(root,'audio','fixture','track.wav');let mixed=0,fontReads=0;
  const trackBytes=Buffer.alloc(44+960000*4);trackBytes.write('RIFF',0);trackBytes.writeUInt32LE(trackBytes.length-8,4);trackBytes.write('WAVEfmt ',8);trackBytes.writeUInt32LE(16,16);trackBytes.writeUInt16LE(3,20);trackBytes.writeUInt16LE(1,22);trackBytes.writeUInt32LE(48000,24);trackBytes.writeUInt32LE(192000,28);trackBytes.writeUInt16LE(4,32);trackBytes.writeUInt16LE(32,34);trackBytes.write('data',36);trackBytes.writeUInt32LE(960000*4,40);for(let index=0;index<48000;index++)trackBytes.writeFloatLE(Math.sin(index*0.1)*0.1,44+index*4);
  const timingOptions={root,buildTrack:async()=>{mixed++;await mkdir(join(root,'audio','fixture'),{recursive:true});await writeFile(trackPath,trackBytes);return{outputPath:trackPath,runtimeDigest:'a'.repeat(64),wav:probeTrackWav(trackBytes,960000,false),kind:'narration_only' as const,qaStatus:'not_checked' as const}},readFont:async()=>{fontReads++;return{family:'Noto Sans CJK SC' as const,runtimeDigest:'a'.repeat(64),charsetSha256:'d'.repeat(64),glyphs:new Set(Array.from('欢迎参加。'))}}};
  await expect(prepareTimingStage(projects,projectId,revisionId,operationId,0,treatmentRef,{root,mustExist:true})).rejects.toThrow('TIMING_STAGE_MISSING');
  const timing=await prepareTimingStage(projects,projectId,revisionId,operationId,0,treatmentRef,timingOptions);
  expect((await projects.store.readFresh<{totalFrames:number;narration:unknown[];captions:unknown[]}>(timing.draftRef.key)).value).toMatchObject({totalFrames:480,narration:[{}],captions:[{}]});
  expect(await prepareTimingStage(projects,projectId,revisionId,operationId,0,treatmentRef,timingOptions)).toEqual(timing);
  expect([mixed,fontReads]).toEqual([1,1]);
  const visualHtml='<!doctype html><html><meta charset="utf-8"><canvas id="c" width="1920" height="1080"></canvas><script>const c=document.getElementById("c"),x=c.getContext("2d");window.render=t=>{x.fillStyle="#f4efe3";x.fillRect(0,0,1920,1080);x.fillText("欢迎参加",100+10*Math.sin(t),200)};window.READY=true;</script></html>';
  let visualCalls=0;const visualOptions={root,limits:{projectCalls:5,projectInputTokens:200000,projectOutputTokens:20000,dailyCalls:10},decide:async()=>{visualCalls++;return{schemaVersion:1,briefVersion:1,styleSlug:style.slug,styleRulesHash:style.rulesHash,timingDraftHash:timing.draftRef.sha256,shotId:'shot',startFrame:0,endFrame:480,factIds:[],assetIds:[],sourceHtml:visualHtml}}};
  await expect(prepareVisualShotStage(projects,projectId,revisionId,operationId,0,treatmentRef,'shot',{root,mustExist:true})).rejects.toThrow('VISUAL_STAGE_MISSING');
  await expect(prepareVisualShotStage(projects,projectId,revisionId,operationId,0,treatmentRef,'shot',{root,env:{VIDEO_DATA_DIR:root}})).rejects.toThrow('GENERATION_DISABLED');
  const visual=await prepareVisualShotStage(projects,projectId,revisionId,operationId,0,treatmentRef,'shot',visualOptions);
  expect(visual.runtimeStatus).toBe('not_checked');
  expect((await projects.store.readFresh<{sourceHtml:string}>(visual.sourceRef.key)).value.sourceHtml).toBe(visualHtml);
  expect(await prepareVisualShotStage(projects,projectId,revisionId,operationId,0,treatmentRef,'shot',visualOptions)).toEqual(visual);
  expect(await prepareVisualShotStage(projects,projectId,revisionId,operationId,0,treatmentRef,'shot',{root,mustExist:true})).toEqual(visual);
  expect(visualCalls).toBe(1);
  let submitted:MediaJob|undefined,qaHash='e'.repeat(64),renderCalls=0;
  await expect(preparePictureShotStage(projects,projectId,revisionId,operationId,0,treatmentRef,'shot',{root,mustExist:true,env:{VIDEO_MEDIA_IMAGE_REF:`sha256:${'a'.repeat(64)}`,VIDEO_MEDIA_RUNTIME_DIGEST:'a'.repeat(64),VIDEO_MEDIA_TIMEOUT_SECONDS:'120'}})).rejects.toThrow('PICTURE_STAGE_MISSING');
  const pictureOptions={root,env:{VIDEO_DATA_DIR:root,VIDEO_MEDIA_IMAGE_REF:`sha256:${'a'.repeat(64)}`,VIDEO_MEDIA_RUNTIME_DIGEST:'a'.repeat(64),VIDEO_MEDIA_TIMEOUT_SECONDS:'120'},pollMs:1,
   executor:{submit:async(job:MediaJob)=>{submitted=job;renderCalls++;return{containerName:'test',containerId:'test',stageKey:job.stageKey,runtimeDigest:job.runtimeDigest}},inspect:async()=>({status:'succeeded' as const,outputs:['output/picture.mp4']}),cancel:async()=>({status:'cancelled' as const})},
   qa:async(_dir:string,_image:string,_path:string,expected:{width:number;height:number;durationSec:number;fps:number;audio:boolean})=>({result:'pass' as const,sha256:qaHash,bytes:1234,frames:Math.round(expected.durationSec*expected.fps),...expected})};
  const picture=await preparePictureShotStage(projects,projectId,revisionId,operationId,0,treatmentRef,'shot',pictureOptions);
  expect(submitted).toMatchObject({startFrame:0,endFrame:480,logicalWidth:1920,logicalHeight:1080,outputWidth:1920,outputHeight:1080,fps:24});
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
   },postMix:async(_root:string,film:{sha256:string})=>{postMixCalls++;return{status:'pass' as const,filmSha256:film.sha256,lines:[{lineId:'line_1',recognizedText:'欢迎参加。',sourceSha256:'b'.repeat(64),asrRuntimeDigest:'b'.repeat(64),wordCount:1,status:'pass' as const}]}}};
  const composite=await prepareCompositeStage(projects,projectId,revisionId,operationId,0,treatmentRef,compositeOptions);
  expect(composite.qualityStatus).toBe('semantic_not_checked');
  expect(await prepareCompositeStage(projects,projectId,revisionId,operationId,0,treatmentRef,compositeOptions)).toEqual(composite);
  expect([compositionCalls,postMixCalls]).toEqual([1,1]);
  const segments:ExcerptSegment[]=[{previewStartMs:0,previewEndMs:5000,sourceStartMs:0,sourceEndMs:5000,shotId:'shot'},{previewStartMs:5000,previewEndMs:7000,sourceStartMs:10000,sourceEndMs:12000,shotId:'shot'},{previewStartMs:7000,previewEndMs:9000,sourceStartMs:16000,sourceEndMs:18000,shotId:'shot'}];
  let excerptCalls=0,previewSha='c'.repeat(64);
  const excerptOptions={root,profile:'full' as const,env:pictureOptions.env,composite:compositeOptions,
   qa:async(_dir:string,_image:string,_path:string,expected:{width:number;height:number;durationSec:number;fps:number;audio:boolean})=>({result:'pass' as const,sha256:previewSha,bytes:2345,frames:Math.round(expected.durationSec*expected.fps),...expected}),
   render:async(input:{root:string;sourceSha256:string;segments:ExcerptSegment[];width:number;height:number;fps:24|30|60})=>{excerptCalls++;const stageKey=previewExcerptStageKey({fullFilmSha256:input.sourceSha256,segments:input.segments,width:input.width,height:input.height,fps:input.fps,runtimeDigest:'a'.repeat(64)});return{stageKey,outputPath:join(root,'preview',stageKey,'output','preview.mp4'),sha256:previewSha,bytes:2345,durationMs:9000,sourceFilmSha256:input.sourceSha256,excerptMap:segments,technicalQa:{result:'pass' as const,sha256:previewSha,bytes:2345,width:1920,height:1080,durationSec:9,fps:24,frames:216,audio:true}}},
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
  const changedTreatment=await prepareTreatmentStage(projects,projectId,changedRevision,operationId,0,{decide:async()=>plan,limits:{projectCalls:5,projectInputTokens:200000,projectOutputTokens:30000,dailyCalls:10}});
  await expect(prepareVoiceStage(projects,projectId,changedRevision,operationId,0,changedTreatment,{...options,generate:async(dir,job)=>{
   const voice=await options.generate(dir,job);
   await updateJson(projects.store,`projects/${projectId}/control`,(c:ProjectControl)=>({...c,consentEpoch:1}));
   return voice;
  }})).rejects.toThrow('PREVIEW_STALE');
  await expect(projects.store.readFresh(`projects/${projectId}/revisions/${changedRevision}/voice-stage`)).rejects.toBeInstanceOf(StoreMissing);
 }finally{await rm(root,{recursive:true,force:true})}
});
