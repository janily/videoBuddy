import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import type {ProjectControl} from '../../src/contracts/video/project';
import {initialUnderstanding} from '../../src/contracts/video/domain';
import {updateJson} from '../../src/services/video/storage/atomic-store';
import {FileStore} from '../../src/services/video/storage/file-store';
import {ProjectStore} from '../../src/services/video/storage/project-store';
import {getStyle} from '../../src/services/video/styles/registry';
import {prepareVoiceStage} from '../../src/services/video/preview/voice-stage';
import {prepareTimingStage} from '../../src/services/video/preview/timing-stage';
import {prepareVisualShotStage} from '../../src/services/video/preview/visual-stage';
import {preparePictureShotStage} from '../../src/services/video/preview/picture-stage';
import {preparePictureSequenceStage} from '../../src/services/video/preview/picture-sequence-stage';
import {prepareCompositeStage} from '../../src/services/video/preview/composite-stage';
import {preparePreviewExcerptStage} from '../../src/services/video/preview/excerpt-stage';
import {canonicalHash} from '../../src/services/video/domain/hash';
import {actualArtifactSha256} from '../../src/services/video/exports/verified-file';
import {resolveArtifact} from '../../src/services/video/exports/access';
import {prepareNarrationPackageStage,NarrationPackageDataSchema} from '../../src/services/video/preview/narration-package-stage';
import {loadPackagedNarration} from '../../src/services/video/audio/narration-package';

async function removeProbeContainer(name:string){
 const child=spawn('docker',['rm','--force',name],{stdio:'ignore'});
 const code=await new Promise<number>((resolve,reject)=>{child.once('error',reject);child.once('close',value=>resolve(value??1))});
 if(code!==0)throw Error('PICTURE_PROBE_CONTAINER_CLEANUP_FAILED');
}

async function main(){
 const root=await mkdtemp(join(tmpdir(),'vb-voice-stage-probe-'));
 const previewProfile=process.argv.includes('--preview-720')?'preview' as const:'probe' as const;
 const wantsPreview=process.argv.includes('--preview')||process.argv.includes('--preview-720');
 const wantsFilm=process.argv.includes('--film')||wantsPreview;
 const wantsPicture=process.argv.includes('--picture')||wantsFilm;
 const wantsNarrationPackage=process.argv.includes('--narration-package')||wantsFilm;
 let pictureContainerName:string|undefined;
 try{
  const projects=new ProjectStore(new FileStore(root)),{projectId}=await projects.create('probe-owner',{schemaVersion:5,clientCommandId:randomUUID(),clientCreateId:randomUUID()});
  const revisionId=randomUUID(),operationId=randomUUID(),messageId=randomUUID(),style=getStyle('crayon-book'),base=initialUnderstanding(),line='上海的活动将在十月八日开始。';
  const fact={id:'event-date',text:'活动十月八日开始',sourceRefs:[{type:'user_message' as const,id:messageId}],status:'confirmed' as const,mustInclude:true,critical:true};
  const understanding={...base,briefVersion:1,subject:'活动预告',sourceMessageIds:[messageId],facts:[fact],preferences:{...base.preferences,durationSec:20,styleSlug:style.slug,voiceMode:'tts' as const}};
  const understandingRef=await projects.index.immutable(`projects/${projectId}/understanding/1`,understanding);
  await updateJson(projects.store,`projects/${projectId}/control`,(control:ProjectControl)=>({...control,briefVersion:1,understandingRef,phase:'preparing_preview' as const,activeProduction:operationId}));
  const plan={schemaVersion:1,briefVersion:1,styleSlug:style.slug,styleRulesHash:style.rulesHash,durationSec:20,aspect:'16:9',fps:24,summary:'活动预告',options:[
   {id:'a',concept:'绘制会场',visualApproach:'蜡笔逐层成形',soundApproach:'轻快打击乐',tradeoff:'动画量多'},
   {id:'b',concept:'角色带路',visualApproach:'跟随人物',soundApproach:'脚步声',tradeoff:'动作成本高'},
   {id:'c',concept:'纸页传递信息',visualApproach:'翻页文字',soundApproach:'纸张拟音',tradeoff:'人物较少'},
  ],selectedOptionId:'a',selectionReason:'日期清晰',shots:[{id:'shot',startFrame:0,endFrame:480,visualIntent:'呈现活动日期',scriptLine:line,factIds:['event-date']}],script:[line]};
  const treatmentRef=await projects.index.immutable(`projects/${projectId}/revisions/${revisionId}/treatment-plan`,plan);
  const first=await prepareVoiceStage(projects,projectId,revisionId,operationId,0,treatmentRef,{root}),replay=await prepareVoiceStage(projects,projectId,revisionId,operationId,0,treatmentRef,{root});
  if(first.verifiedRef.sha256!==replay.verifiedRef.sha256)throw Error('VOICE_STAGE_REPLAY_CHANGED');
  const verified=(await projects.store.readFresh<{lines:Array<{asrStatus:string;asr:{runtimeDigest:string};wordTimings:Array<unknown>;voice:{wav:{sha256:string;durationMs:number};runtimeDigest:string}}> }>(first.verifiedRef.key)).value;
  if(verified.lines.length!==1||verified.lines[0].asrStatus!=='pass'||verified.lines[0].wordTimings.length===0)throw Error('VOICE_STAGE_PROBE_FAILED');
  const evidence={technicalProbeOnly:true,styleSlug:style.slug,briefVersion:1,voiceRuntimeDigest:verified.lines[0].voice.runtimeDigest,asrRuntimeDigest:verified.lines[0].asr.runtimeDigest,voiceSha256:verified.lines[0].voice.wav.sha256,voiceDurationMs:verified.lines[0].voice.wav.durationMs,wordCount:verified.lines[0].wordTimings.length,asrStatus:verified.lines[0].asrStatus,immutablePlanSha256:first.planRef.sha256,immutableVerifiedSha256:first.verifiedRef.sha256,replayIdentical:true,limits:'One synthetic 20-second project brief and one real offline TTS/ASR line; no visual preview, full mix, listening review or user footage.'};
  if(process.argv.includes('--record'))await writeFile('docs/engineering/evidence/voice-stage-probe.json',JSON.stringify(evidence,null,2)+'\n');
  process.stdout.write(JSON.stringify(evidence)+'\n');
  if(wantsPicture||wantsNarrationPackage){
   const image=process.env.VIDEO_MEDIA_IMAGE_REF;
   if(!image||!/^sha256:[a-f0-9]{64}$/.test(image))throw Error('CAPABILITY_UNAVAILABLE: VIDEO_MEDIA_IMAGE_REF');
   process.env.VIDEO_MEDIA_RUNTIME_DIGEST=image.slice(7);
   process.env.VIDEO_MEDIA_TIMEOUT_SECONDS='300';
  }
  if(process.argv.includes('--timing')||wantsPicture||wantsNarrationPackage){
   const timing=await prepareTimingStage(projects,projectId,revisionId,operationId,0,treatmentRef,{root});
   const timingReplay=await prepareTimingStage(projects,projectId,revisionId,operationId,0,treatmentRef,{root});
   if(timing.draftRef.sha256!==timingReplay.draftRef.sha256)throw Error('TIMING_STAGE_REPLAY_CHANGED');
   const draft=(await projects.store.readFresh<{totalFrames:number;fps:number;narration:Array<{lineId:string;startSample:number;endSample:number}>;captions:Array<{text:string;startFrame:number;endFrame:number}>;track:{sha256:string;samples:number;runtimeDigest:string;silence:boolean};font:{family:string;charsetSha256:string}|null;qualityStatus:string}>(timing.draftRef.key)).value;
   if(draft.totalFrames!==480||draft.narration.length!==1||draft.captions.length!==1||draft.track.samples!==960000||draft.track.silence||!draft.font||draft.qualityStatus!=='semantic_not_checked')throw Error('TIMING_STAGE_PROBE_FAILED');
   const result={technicalProbeOnly:true,styleSlug:style.slug,voiceStageSha256:first.verifiedRef.sha256,timingDraftSha256:timing.draftRef.sha256,totalFrames:draft.totalFrames,fps:draft.fps,narration:draft.narration,captions:draft.captions,track:{sha256:draft.track.sha256,samples:draft.track.samples,runtimeDigest:draft.track.runtimeDigest,silence:draft.track.silence},font:draft.font,replayIdentical:true,qualityStatus:draft.qualityStatus,limits:'One synthetic project brief; real offline voice, ASR, 48 kHz narration mix, pinned CJK font and subtitle timing. No visual source, burned captions, preview video or listening review.'};
   if(process.argv.includes('--record'))await writeFile('docs/engineering/evidence/timing-stage-probe.json',JSON.stringify(result,null,2)+'\n');
   process.stdout.write(JSON.stringify(result)+'\n');
   if(wantsNarrationPackage){
    const packaged=await prepareNarrationPackageStage(projects,projectId,revisionId,operationId,0,treatmentRef,{root});
    const replay=await prepareNarrationPackageStage(projects,projectId,revisionId,operationId,0,treatmentRef,{root,mustExist:true});
    if(packaged.packageRef.sha256!==replay.packageRef.sha256)throw Error('NARRATION_PACKAGE_REPLAY_CHANGED');
    const data=NarrationPackageDataSchema.parse((await projects.store.readFresh(packaged.packageRef.key)).value),sourceRef=data.sources[0].sourceRef;
    const loaded=await loadPackagedNarration(projects.store,root,projectId,revisionId,sourceRef);
    if(loaded.source.wav.sha256!==verified.lines[0].voice.wav.sha256||loaded.words.words.length!==verified.lines[0].wordTimings.length)throw Error('NARRATION_PACKAGE_PROBE_FAILED');
    const workingVoiceDirectoryRemoved=!wantsPicture;
    if(workingVoiceDirectoryRemoved)await rm(join(root,'voice'),{recursive:true});
    const independent=await loadPackagedNarration(projects.store,root,projectId,revisionId,sourceRef);
    if(independent.timelineLine.audioRef.sha256!==loaded.timelineLine.audioRef.sha256)throw Error('NARRATION_PACKAGE_REPLAY_CHANGED');
    const objectPath=join(root,'objects',independent.timelineLine.audioRef.key);
    await writeFile(objectPath,Buffer.from('intentional tamper for technical probe'));
    let objectTamperRejected=false;
    try{await loadPackagedNarration(projects.store,root,projectId,revisionId,sourceRef)}catch(error){if(error instanceof Error&&error.message==='NARRATION_AUDIO_CHANGED')objectTamperRejected=true;else throw error}
    if(!objectTamperRejected)throw Error('NARRATION_PACKAGE_TAMPER_ACCEPTED');
    // Picture/composition probes still need the intact object and original work directories.
    if(wantsPicture){const source=(await projects.store.readFresh<{lines:Array<{voice:{outputPath:string}}> }>(first.verifiedRef.key)).value;await writeFile(objectPath,await readFile(source.lines[0].voice.outputPath));await loadPackagedNarration(projects.store,root,projectId,revisionId,sourceRef)}
    const packageEvidence={executedAt:new Date().toISOString(),technicalProbeOnly:true,voiceRuntimeDigest:loaded.source.voiceConfig.runtimeDigest,asrRuntimeDigest:loaded.words.asrRuntimeDigest,narrationPackageSha256:packaged.packageRef.sha256,audioSha256:loaded.source.wav.sha256,audioBytes:loaded.source.wav.bytes,sourceSampleRate:loaded.source.wav.sampleRate,sourceSamples:loaded.source.wav.samples,timelineStartSample:loaded.timelineLine.startSample,timelineEndSample:loaded.timelineLine.endSample,timelineSampleRate:48000,wordCount:loaded.words.words.length,recognizedText:loaded.words.recognizedText,replayIdentical:true,workingVoiceDirectoryRemoved,independentObjectRead:true,objectTamperRejected,qualityStatus:data.qualityStatus,limits:'Synthetic frozen brief, one actual offline Chinese TTS/ASR line and private durable WAV/word-timing references. No paid model, music, user recording, complete FilmSpec, listening/style QA or publish/approval.'};
    if(process.argv.includes('--record'))await writeFile(`docs/engineering/evidence/${wantsPicture?`narration-package-${previewProfile}-probe.json`:'narration-package-probe.json'}`,JSON.stringify(packageEvidence,null,2)+'\n');
    process.stdout.write(JSON.stringify(packageEvidence)+'\n');
   }
   if(wantsPicture){
    const sourceHtml='<!doctype html><html><meta charset="utf-8"><body style="margin:0"><canvas id="c" width="1920" height="1080"></canvas><script>const c=document.getElementById("c"),x=c.getContext("2d");window.render=t=>{x.fillStyle="#f4eee5";x.fillRect(0,0,1920,1080);x.fillStyle="#48657a";x.fillRect(80,80,1760,920);x.fillStyle="#ffffff";x.font="bold 110px sans-serif";x.fillText("上海活动 10 月 8 日",170,520);x.fillStyle="#f3ba65";x.fillRect(160+t*20,680,400,28)};window.READY=true;</script></body></html>';
    const visual=await prepareVisualShotStage(projects,projectId,revisionId,operationId,0,treatmentRef,'shot',{root,decide:async()=>({schemaVersion:1,briefVersion:1,styleSlug:style.slug,styleRulesHash:style.rulesHash,timingDraftHash:timing.draftRef.sha256,shotId:'shot',startFrame:0,endFrame:480,factIds:['event-date'],assetIds:[],sourceHtml}),limits:{projectCalls:5,projectInputTokens:200000,projectOutputTokens:20000,dailyCalls:10}});
    const picture=await preparePictureShotStage(projects,projectId,revisionId,operationId,0,treatmentRef,'shot',{root,profile:previewProfile});
    pictureContainerName=`vb-${operationId}-picture-${previewProfile}-${canonicalHash({shotId:'shot'}).slice(0,12)}`;
    const replay=await preparePictureShotStage(projects,projectId,revisionId,operationId,0,treatmentRef,'shot',{root,profile:previewProfile});
    if(picture.stageKey!==replay.stageKey||picture.technicalQa.sha256!==replay.technicalQa.sha256)throw Error('PICTURE_STAGE_REPLAY_CHANGED');
    const pictureEvidence={technicalProbeOnly:true,styleSlug:style.slug,visualSourceSha256:visual.sourceSha256,timingDraftSha256:timing.draftRef.sha256,stageKey:picture.stageKey,runtimeDigest:picture.runtimeDigest,technicalQa:picture.technicalQa,replayIdentical:true,limits:`Synthetic HTML via injected visual decision, ${picture.technicalQa.width}x${picture.technicalQa.height} technical render of all 480 frames; no paid Visual model, asset transfer, semantic/style QA, 1080p or user preview.`};
    if(process.argv.includes('--record'))await writeFile(`docs/engineering/evidence/${previewProfile==='preview'?'picture-stage-720-probe.json':'picture-stage-probe.json'}`,JSON.stringify(pictureEvidence,null,2)+'\n');
    process.stdout.write(JSON.stringify(pictureEvidence)+'\n');
    if(wantsFilm){
     const sequence=await preparePictureSequenceStage(projects,projectId,revisionId,operationId,0,treatmentRef,{root,profile:previewProfile});
     const composite=await prepareCompositeStage(projects,projectId,revisionId,operationId,0,treatmentRef,{root,profile:previewProfile});
     const compositeReplay=await prepareCompositeStage(projects,projectId,revisionId,operationId,0,treatmentRef,{root,profile:previewProfile});
     if(composite.technicalQa.sha256!==compositeReplay.technicalQa.sha256)throw Error('COMPOSITE_STAGE_REPLAY_CHANGED');
     const compositeEvidence={technicalProbeOnly:true,styleSlug:style.slug,narrationPackageSha256:composite.narrationPackageSha256,timingDraftSha256:timing.draftRef.sha256,visualSourceSha256:visual.sourceSha256,pictureSequence:{stageKey:sequence.stageKey,sha256:sequence.technicalQa.sha256,frames:sequence.technicalQa.frames},stageKey:composite.stageKey,technicalQa:composite.technicalQa,loudness:composite.loudness,postMix:composite.postMix,qualityStatus:composite.qualityStatus,replayIdentical:true,limits:'Synthetic Visual source in one 20-second project, real local TTS/ASR, narration mix, burned caption, video composition, post-mix ASR and independent decode. No paid model, 1080p, style/semantic QA, user preview or approval.'};
     if(process.argv.includes('--record'))await writeFile(`docs/engineering/evidence/${previewProfile==='preview'?'composite-stage-720-probe.json':'composite-stage-probe.json'}`,JSON.stringify(compositeEvidence,null,2)+'\n');
     process.stdout.write(JSON.stringify(compositeEvidence)+'\n');
     if(wantsPreview){
      const segments=[{previewStartMs:0,previewEndMs:5000,sourceStartMs:0,sourceEndMs:5000,shotId:'shot'},{previewStartMs:5000,previewEndMs:7000,sourceStartMs:10000,sourceEndMs:12000,shotId:'shot'},{previewStartMs:7000,previewEndMs:9000,sourceStartMs:16000,sourceEndMs:18000,shotId:'shot'}];
      const preview=await preparePreviewExcerptStage(projects,projectId,revisionId,operationId,0,treatmentRef,segments,{root,profile:previewProfile});
      const replayed=await preparePreviewExcerptStage(projects,projectId,revisionId,operationId,0,treatmentRef,segments,{root,profile:previewProfile});
      if(preview.previewArtifactSha256!==replayed.previewArtifactSha256||preview.artifactId!==replayed.artifactId)throw Error('PREVIEW_STAGE_REPLAY_CHANGED');
      const artifact=(await projects.store.readFresh<{objectRef:{key:string;sha256:string;bytes:number}}>(`projects/${projectId}/artifacts/${preview.artifactId}/manifest`)).value;
      if(artifact.objectRef.sha256!==preview.previewArtifactSha256||await actualArtifactSha256(root,artifact.objectRef.key,artifact.objectRef.bytes)!==preview.previewArtifactSha256)throw Error('PREVIEW_STAGE_STORAGE_CHANGED');
      let privateBeforeCommit=false;try{await resolveArtifact(projects,'probe-owner',projectId,preview.artifactId)}catch(error){privateBeforeCommit=error instanceof Error&&error.message==='ACCESS_NOT_FOUND'}
      if(!privateBeforeCommit)throw Error('PREVIEW_STAGE_EARLY_ACCESS');
      const previewEvidence={technicalProbeOnly:true,sourceFilmSha256:preview.sourceFilmSha256,excerptMap:preview.excerptMap,stageKey:preview.stageKey,durationMs:preview.durationMs,artifactId:preview.artifactId,artifactSha256:preview.previewArtifactSha256,technicalQa:preview.technicalQa,privateBeforeCommit,replayIdentical:true,qualityStatus:preview.qualityStatus,limits:`Nine-second excerpt from the same synthetic ${preview.technicalQa.width}x${preview.technicalQa.height} project AV; real private object bytes and blocked public access before preview pointer. No FilmSpec package, user-visible preview, approval, real model or style QA.`};
      if(process.argv.includes('--record'))await writeFile(`docs/engineering/evidence/${previewProfile==='preview'?'preview-720-stage-probe.json':'preview-stage-probe.json'}`,JSON.stringify(previewEvidence,null,2)+'\n');
      process.stdout.write(JSON.stringify(previewEvidence)+'\n');
     }
    }
   }
  }
 }finally{try{if(pictureContainerName)await removeProbeContainer(pictureContainerName)}finally{await rm(root,{recursive:true,force:true})}}
}
main().catch(error=>{console.error(error instanceof Error?error.message:'VOICE_STAGE_PROBE_FAILED');process.exitCode=1});
