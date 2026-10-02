import{expect,it}from'vitest';
import{mkdtemp,rm}from'node:fs/promises';
import{tmpdir}from'node:os';
import{join}from'node:path';
import{randomUUID}from'node:crypto';
import{FileStore}from'@/services/video/storage/file-store';
import{ProjectStore}from'@/services/video/storage/project-store';
import{initialUnderstanding}from'@/contracts/video/domain';
import{getStyle}from'@/services/video/styles/registry';
import{loadVerifiedFilmPackage}from'@/contracts/video/film-package';

it('T01 derives timeline authority from immutable facts, source and audio manifests',async()=>{
 const root=await mkdtemp(join(tmpdir(),'vb-film-package-'));
 try{
  const projects=new ProjectStore(new FileStore(root)),projectId=randomUUID(),revisionId=randomUUID(),messageId=randomUUID(),prefix=`projects/${projectId}/revisions/${revisionId}`,style=getStyle('crayon-book');
  const fact={id:'fact-a',text:'活动十月八日开始',sourceRefs:[{type:'user_message' as const,id:messageId}],status:'confirmed' as const,mustInclude:true,critical:true};
  const understanding={...initialUnderstanding(),briefVersion:1,subject:'活动预告',sourceMessageIds:[messageId],facts:[fact],preferences:{...initialUnderstanding().preferences,durationSec:20,aspect:'16:9' as const,styleSlug:style.slug,musicMode:'composed' as const}};
  const index=projects.index,understandingRef=await index.immutable(`projects/${projectId}/understanding/1`,understanding),sourceCodeRef=await index.immutable(`${prefix}/source-code`,{html:'<!doctype html><canvas id="scene"></canvas>'}),musicRef=await index.immutable(`${prefix}/music-recipe`,{recipe:'percussion from timeline cue'}),rightsRef=await index.immutable(`${prefix}/rights`,{basis:'generated',source:'local synthesis'});
  const sourceManifest={schemaVersion:1,modules:[{id:'scene-a',sourceRef:sourceCodeRef}],actors:[{id:'actor-a',sourceModuleId:'scene-a'}],captionStyles:[{id:'caption-a',styleRef:await index.immutable(`${prefix}/caption-style`,{fontSize:42})}]};
  const audioManifest={schemaVersion:1,sources:[{id:'music-a',kind:'generated',sourceRef:musicRef,rightsRef}],buses:[{id:'music'},{id:'voice'}]};
  const timeline={totalFrames:480,fps:24,sampleRate:48000,sections:[{id:'intro',startFrame:0,endFrame:480,bpm:120,beatsPerBar:4,beatUnit:4,barOffset:0}],shots:[{id:'shot-a',startFrame:0,endFrame:480,purpose:'introduce',framing:'wide',camera:'static',sourceModule:'scene-a',actorIds:['actor-a'],transitionIn:{kind:'cut',overlapFrames:0},transitionOut:{kind:'cut',overlapFrames:0},factIds:['fact-a']}],cues:[{id:'beat-a',sourceShotId:'shot-a',requestedTimeUs:1000000,alignmentPolicy:'frame',resolvedFrame:24,resolvedSample:48000,quantizationErrorUs:0}],narration:[],music:[{eventId:'music-event',cueId:'beat-a',source:'music-a',durationSamples:48000,gainDb:-12,pan:0}],foley:[],captions:[],intentionalBlackRanges:[],intentionalSilenceRanges:[{startSample:0,endSample:48000,buses:['voice']}]};
  const treatmentPlan={schemaVersion:1,briefVersion:1,styleSlug:style.slug,styleRulesHash:style.rulesHash,durationSec:20,aspect:'16:9',fps:24,summary:'介绍活动',options:[{id:'a',concept:'绘出场地',visualApproach:'蜡笔逐层成形',soundApproach:'打击乐',tradeoff:'节奏快'},{id:'b',concept:'角色走入场地',visualApproach:'跟随角色',soundApproach:'脚步声',tradeoff:'动作复杂'},{id:'c',concept:'纸页展示日期',visualApproach:'翻页',soundApproach:'翻书声',tradeoff:'人物少'}],selectedOptionId:'a',selectionReason:'事实易读',shots:[{id:'shot-a',startFrame:0,endFrame:480,visualIntent:'显示活动日期',scriptLine:'活动将在十月八日开始',factIds:['fact-a']}],script:['活动将在十月八日开始']};
  const planRef=await index.immutable(`${prefix}/treatment-plan`,treatmentPlan);
  const refs={treatmentRef:await index.immutable(`${prefix}/treatment`,{schemaVersion:1,summary:'介绍活动',script:['活动将在十月八日开始'],factIds:['fact-a'],planRef}),factsRef:await index.immutable(`${prefix}/facts`,{schemaVersion:1,facts:[fact]}),timelineRef:await index.immutable(`${prefix}/timeline`,timeline),assetManifestRef:await index.immutable(`${prefix}/assets`,{schemaVersion:1,assets:[]}),sourceManifestRef:await index.immutable(`${prefix}/sources`,sourceManifest),audioManifestRef:await index.immutable(`${prefix}/audio`,audioManifest)};
  const spec={schemaVersion:5,projectId,revisionId,briefVersion:1,style:{slug:style.slug,packVersion:style.packVersion,upstreamCommit:style.upstreamCommit},output:{width:1920,height:1080,fps:24,totalFrames:480,sampleRate:48000},seed:3,understandingRef,...refs,runtimeDigest:'a'.repeat(64),qualityPolicyVersion:'v1'};
  await expect(loadVerifiedFilmPackage(projects.store,spec)).resolves.toMatchObject({filmSpec:{projectId,revisionId},timeline:{totalFrames:480}});
  const alteredPlanRef=await index.immutable(`${prefix}/treatment-plan`,{...treatmentPlan,shots:[{...treatmentPlan.shots[0],factIds:[]}]});
  const alteredTreatmentRef=await index.immutable(`${prefix}/treatment`,{schemaVersion:1,summary:'介绍活动',script:treatmentPlan.script,factIds:['fact-a'],planRef:alteredPlanRef});
  await expect(loadVerifiedFilmPackage(projects.store,{...spec,treatmentRef:alteredTreatmentRef})).rejects.toThrow('TREATMENT_FACT_MISSING');
  const missingModuleRef=await index.immutable(`${prefix}/sources`,{...sourceManifest,modules:[{id:'other',sourceRef:sourceCodeRef}],actors:[]});
  await expect(loadVerifiedFilmPackage(projects.store,{...spec,sourceManifestRef:missingModuleRef})).rejects.toThrow('TIMELINE_REFERENCE');
  const staleUnderstandingRef=await index.immutable(`projects/${projectId}/understanding/2`,{...understanding,briefVersion:2});
  await expect(loadVerifiedFilmPackage(projects.store,{...spec,understandingRef:staleUnderstandingRef})).rejects.toThrow('FILM_BRIEF_CHANGED');
  const forgedFactsRef=await index.immutable(`${prefix}/facts`,{schemaVersion:1,facts:[{...fact,id:'invented-fact'}]});
  await expect(loadVerifiedFilmPackage(projects.store,{...spec,factsRef:forgedFactsRef})).rejects.toThrow('FILM_FACT_INVALID');
  const unknownAssetId=randomUUID(),analysisRef=await index.immutable(`projects/${projectId}/assets/${unknownAssetId}/analysis`,{schemaVersion:5,assetId:unknownAssetId,sha256:'b'.repeat(64),trust:'untrusted_material'});
  const unknownAssetManifestRef=await index.immutable(`${prefix}/assets`,{schemaVersion:1,assets:[{id:unknownAssetId,analysisRef,rightsRef,usage:'illustration'}]});
  await expect(loadVerifiedFilmPackage(projects.store,{...spec,assetManifestRef:unknownAssetManifestRef})).rejects.toThrow('FILM_ASSET_INVALID');
  const old=await projects.store.readFresh<typeof timeline>(refs.timelineRef.key);
  await projects.store.cas(refs.timelineRef.key,old.etag,{...timeline,shots:[{...timeline.shots[0],purpose:'changed'}]});
  await expect(loadVerifiedFilmPackage(projects.store,spec)).rejects.toThrow('FILM_REF_CHANGED');
 }finally{await rm(root,{recursive:true,force:true})}
});
