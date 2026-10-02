import{randomUUID}from'node:crypto';
import{initialUnderstanding}from'@/contracts/video/domain';
import{canonicalHash}from'@/services/video/domain/hash';
import{createPreviewBundle,type PreviewBundle}from'@/services/video/preview/bundle';
import type{ExcerptSegment}from'@/services/video/preview/excerpt';
import type{ProjectStore}from'@/services/video/storage/project-store';
import{getStyle}from'@/services/video/styles/registry';

export async function seedPreviewBundle(projects:ProjectStore,input:{projectId:string;previewArtifactSha256:string;briefVersion?:number;revisionId?:string;previewId?:string;previewArtifactId?:string;durationSec?:number;script?:string[];factTexts?:string[];summary?:string;qualityPolicySha256?:string;excerptMap?:ExcerptSegment[];createdAt?:number}):Promise<PreviewBundle>{
 const{projectId}=input,revisionId=input.revisionId||randomUUID(),briefVersion=input.briefVersion??3,durationSec=input.durationSec??45,style=getStyle('crayon-book'),prefix=`projects/${projectId}/revisions/${revisionId}`,messageId=randomUUID();
 const script=input.script||['上海的活动将在十月八日开始。'],summary=input.summary||'活动预告';
 const facts=(input.factTexts||['活动在十月八日开始']).map((text,index)=>({id:`fact-${index}`,text,sourceRefs:[{type:'user_message' as const,id:messageId}],status:'confirmed' as const,mustInclude:true,critical:true}));
 const understanding={...initialUnderstanding(),briefVersion,subject:summary,sourceMessageIds:[messageId],facts,preferences:{...initialUnderstanding().preferences,durationSec,aspect:'16:9' as const,styleSlug:style.slug}};
 const index=projects.index,understandingRef=await index.immutable(`projects/${projectId}/understanding/${briefVersion}`,understanding),sourceRef=await index.immutable(`${prefix}/source-code`,{html:'<!doctype html><canvas id="scene"></canvas>'});
 const sourceManifest={schemaVersion:1,modules:[{id:'shot',sourceRef}],actors:[],captionStyles:[]};
 const timeline={totalFrames:durationSec*24,fps:24,sampleRate:48000,sections:[{id:'whole',startFrame:0,endFrame:durationSec*24,bpm:120,beatsPerBar:4,beatUnit:4,barOffset:0}],shots:[{id:'shot',startFrame:0,endFrame:durationSec*24,purpose:'introduce',framing:'wide',camera:'static',sourceModule:'shot',actorIds:[],transitionIn:{kind:'cut',overlapFrames:0},transitionOut:{kind:'cut',overlapFrames:0},factIds:facts.map(f=>f.id)}],cues:[],narration:[],music:[],foley:[],captions:[],intentionalBlackRanges:[],intentionalSilenceRanges:[]};
 const treatmentPlan={schemaVersion:1,briefVersion,styleSlug:style.slug,styleRulesHash:style.rulesHash,durationSec,aspect:'16:9',fps:24,summary,options:[{id:'a',concept:'逐层绘出主题',visualApproach:'手绘场景逐帧出现',soundApproach:'节奏打击',tradeoff:'动作较多'},{id:'b',concept:'角色带领观看',visualApproach:'角色走进场景',soundApproach:'脚步拟音',tradeoff:'角色制作较复杂'},{id:'c',concept:'纸页呈现信息',visualApproach:'翻页展现文字',soundApproach:'纸张声音',tradeoff:'表演较少'}],selectedOptionId:'a',selectionReason:'能覆盖确认的关键信息',shots:[{id:'shot',startFrame:0,endFrame:durationSec*24,visualIntent:'展示主题',scriptLine:script.join(' '),factIds:facts.map(f=>f.id)}],script:[script.join(' ')]};
 const planRef=await index.immutable(`${prefix}/treatment-plan`,treatmentPlan);
 const treatmentRef=await index.immutable(`${prefix}/treatment`,{schemaVersion:1,summary,script,factIds:facts.map(f=>f.id),planRef}),factsRef=await index.immutable(`${prefix}/facts`,{schemaVersion:1,facts}),timelineRef=await index.immutable(`${prefix}/timeline`,timeline),assetManifestRef=await index.immutable(`${prefix}/assets`,{schemaVersion:1,assets:[]}),sourceManifestRef=await index.immutable(`${prefix}/sources`,sourceManifest),audioManifestRef=await index.immutable(`${prefix}/audio`,{schemaVersion:1,sources:[],buses:[{id:'voice'}]});
 const mediaDigest='1'.repeat(64),filmSpec={schemaVersion:5,projectId,revisionId,briefVersion,style:{slug:style.slug,packVersion:style.packVersion,upstreamCommit:style.upstreamCommit},output:{width:1920,height:1080,fps:24,totalFrames:durationSec*24,sampleRate:48000},seed:1,understandingRef,treatmentRef,factsRef,timelineRef,assetManifestRef,sourceManifestRef,audioManifestRef,runtimeDigest:mediaDigest,qualityPolicyVersion:'v1'};
 const filmSpecRef=await index.immutable(`${prefix}/film`,filmSpec);
 return createPreviewBundle({previewId:input.previewId||randomUUID(),revisionId,briefVersion,filmSpecRef:{...filmSpecRef,mime:'application/json'},
  renderInputs:{sourceCodeSha256:canonicalHash(sourceManifest.modules.map(item=>({id:item.id,sha256:item.sourceRef.sha256}))),timelineSha256:timelineRef.sha256,audioSha256:audioManifestRef.sha256,assetSha256s:[],fontSha256s:[],profile:{width:1920,height:1080,fps:24},runtimeDigests:{media:mediaDigest},qualityPolicySha256:input.qualityPolicySha256||'3'.repeat(64)},
  script,facts:facts.map(f=>({text:f.text,source:'用户确认'})),criticalFacts:facts.map(f=>({text:f.text,source:'用户确认'})),summary,previewArtifactId:input.previewArtifactId||randomUUID(),previewArtifactSha256:input.previewArtifactSha256,
  excerptMap:input.excerptMap||[{previewStartMs:0,previewEndMs:8000,sourceStartMs:0,sourceEndMs:8000,shotId:'shot'}],sourceDurationMs:durationSec*1000,qualityEvidenceRefs:[`${prefix}/qa/preview`]},input.createdAt);
}
