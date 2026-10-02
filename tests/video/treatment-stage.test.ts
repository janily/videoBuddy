import{expect,it}from'vitest';
import{mkdtemp,rm,readdir}from'node:fs/promises';
import{tmpdir}from'node:os';
import{join}from'node:path';
import{randomUUID}from'node:crypto';
import{FileStore}from'@/services/video/storage/file-store';
import{ProjectStore}from'@/services/video/storage/project-store';
import{updateJson}from'@/services/video/storage/atomic-store';
import{initialUnderstanding}from'@/contracts/video/domain';
import type{ProjectControl}from'@/contracts/video/project';
import{getStyle}from'@/services/video/styles/registry';
import{prepareTreatmentStage}from'@/services/video/preview/treatment-stage';

it('T11 reserves one real model effect and never publishes a plan after the preview fence changes',async()=>{
 const root=await mkdtemp(join(tmpdir(),'vb-treatment-stage-'));
 try{
  const projects=new ProjectStore(new FileStore(root)),owner='owner',created=await projects.create(owner,{schemaVersion:5,clientCommandId:randomUUID(),clientCreateId:randomUUID()}),projectId=created.projectId,operationId=randomUUID(),revisionId=randomUUID(),style=getStyle('crayon-book'),messageId=randomUUID();
  const fact={id:'date',text:'活动十月八日开始',sourceRefs:[{type:'user_message' as const,id:messageId}],status:'confirmed' as const,mustInclude:true,critical:true};
  const understanding={...initialUnderstanding(),briefVersion:1,subject:'活动预告',sourceMessageIds:[messageId],facts:[fact],preferences:{...initialUnderstanding().preferences,durationSec:20,styleSlug:style.slug}};
  const understandingRef=await projects.index.immutable(`projects/${projectId}/understanding/1`,understanding);
  await updateJson(projects.store,`projects/${projectId}/control`,(c:ProjectControl)=>({...c,briefVersion:1,understandingRef,phase:'preparing_preview' as const,activeProduction:operationId}));
  const plan={schemaVersion:1,briefVersion:1,styleSlug:style.slug,styleRulesHash:style.rulesHash,durationSec:20,aspect:'16:9',fps:24,summary:'活动预告',options:[{id:'a',concept:'绘出会场',visualApproach:'蜡笔逐层成形',soundApproach:'打击乐',tradeoff:'节奏快'},{id:'b',concept:'角色带路',visualApproach:'跟随人物',soundApproach:'脚步',tradeoff:'动作多'},{id:'c',concept:'纸页展示',visualApproach:'翻页文字',soundApproach:'纸张',tradeoff:'人物少'}],selectedOptionId:'a',selectionReason:'事实清晰',shots:[{id:'shot',startFrame:0,endFrame:480,visualIntent:'活动日期',scriptLine:'十月八日开始',factIds:['date']}],script:['十月八日开始']};
  let calls=0;const decide=async()=>{calls++;return plan};const limits={projectCalls:4,projectInputTokens:200000,projectOutputTokens:20000,dailyCalls:10};
  const first=await prepareTreatmentStage(projects,projectId,revisionId,operationId,0,{decide,limits});
  const replay=await prepareTreatmentStage(projects,projectId,revisionId,operationId,0,{decide,limits});
  expect(first).toEqual(replay);expect(calls).toBe(1);
  expect((await projects.store.readFresh<typeof plan>(first.key)).value.selectedOptionId).toBe('a');
  await updateJson(projects.store,`projects/${projectId}/control`,(c:ProjectControl)=>({...c,consentEpoch:1,activeProduction:null}));
  await expect(prepareTreatmentStage(projects,projectId,revisionId,operationId,0,{decide,limits})).rejects.toThrow('PREVIEW_STALE');
  expect(calls).toBe(1);
  const changedOperation=randomUUID(),changedRevision=randomUUID();
  await updateJson(projects.store,`projects/${projectId}/control`,(c:ProjectControl)=>({...c,activeProduction:changedOperation}));
  let changedCalls=0;
  await expect(prepareTreatmentStage(projects,projectId,changedRevision,changedOperation,1,{limits,decide:async()=>{
   changedCalls++;
   await updateJson(projects.store,`projects/${projectId}/control`,(c:ProjectControl)=>({...c,consentEpoch:2}));
   return plan;
  }})).rejects.toThrow('PREVIEW_STALE');
  expect(changedCalls).toBe(1);
  await expect(readdir(join(root,'projects',projectId,'revisions',changedRevision,'treatment-plan'))).rejects.toThrow();
  const unknownOperation=randomUUID(),unknownRevision=randomUUID();
  await updateJson(projects.store,`projects/${projectId}/control`,(c:ProjectControl)=>({...c,activeProduction:unknownOperation}));
  let unknownCalls=0;const uncertain=async()=>{unknownCalls++;throw Error('PROVIDER_UNAVAILABLE')};
  await expect(prepareTreatmentStage(projects,projectId,unknownRevision,unknownOperation,2,{limits,decide:uncertain})).rejects.toThrow('PROVIDER_UNAVAILABLE');
  await expect(prepareTreatmentStage(projects,projectId,unknownRevision,unknownOperation,2,{limits,decide:uncertain})).rejects.toThrow('EFFECT_UNKNOWN');
  expect(unknownCalls).toBe(1);
 }finally{await rm(root,{recursive:true,force:true})}
});
