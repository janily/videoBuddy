import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {z} from 'zod';
import type {ProjectControl} from '@/contracts/video/project';
import type {Understanding} from '@/contracts/video/domain';
import {imageUnderstandingInput,guardImageUnderstanding,ImageAnalysisRecordSchema,imageAnalysisText,type ImageUnderstandingInput} from '@/contracts/video/image-understanding';
import {runImageUnderstanding} from '@/mastra/video/image-understanding';
import {configuredModel} from '@/mastra/video/model-adapter';
import {requireGeneration,readConfiguration,type Environment} from '@/services/video/config/environment';
import type {ProjectStore} from '@/services/video/storage/project-store';
import {StoreMissing,updateJson} from '@/services/video/storage/atomic-store';
import {runEffect} from '@/services/video/commands/effect-ledger';
import {canonicalHash} from '@/services/video/domain/hash';
import {readNarrationJson} from '@/services/video/audio/narration-package';
import {reserveModelBudget,modelLimits,type ModelLimits} from '@/services/video/budget/model-budget';
import {withAccountedModel} from '@/services/video/budget/model-call';
import {LocalAssetBytes} from './local-bytes';
export interface ImageAnalysisOptions{env?:Environment;limits?:ModelLimits;analyze?:(input:ImageUnderstandingInput,data:Uint8Array,assertActive:()=>Promise<void>)=>Promise<unknown>}
export async function prepareImageAnalysis(projects:ProjectStore,root:string,projectId:string,assetId:string,options:ImageAnalysisOptions={}){
 if(![projectId,assetId].every(id=>z.uuid().safeParse(id).success))throw Error('IMAGE_INPUT_INVALID');
 const p=`projects/${projectId}`,key=p+'/control',bytes=new LocalAssetBytes(root),initial=(await projects.store.readFresh<ProjectControl>(key)).value,asset=initial.assets.find(a=>a.id===assetId);
 if(!asset||!['uploaded','analyzing','ready'].includes(asset.status)||!asset.rightsConfirmed||!asset.sha256||!asset.bytes)throw Error('IMAGE_ASSET_CHANGED');
 const original=await readFile(bytes.path(projectId,assetId)),input=imageUnderstandingInput({assetId,mime:asset.declaredMime,sha256:asset.sha256,bytes:asset.bytes,intendedUse:asset.intendedUse},original);
 async function fence(){const c=(await projects.store.readFresh<ProjectControl>(key)).value,a=c.assets.find(a=>a.id===assetId);if(c.deletedAt||!Number.isFinite(Date.parse(c.expiresAt))||Date.parse(c.expiresAt)<=Date.now())throw Error('ACCESS_NOT_FOUND');if(!a||!['uploaded','analyzing','ready'].includes(a.status)||!a.rightsConfirmed||a.sha256!==input.sha256||a.bytes!==input.bytes||a.declaredMime!==input.mime||a.intendedUse!==input.intendedUse)throw Error('IMAGE_ASSET_CHANGED');const actual=await bytes.inspect(projectId,assetId,input.mime);if(actual.sha256!==input.sha256||actual.bytes!==input.bytes)throw Error('IMAGE_INPUT_CHANGED')}
 await fence();
 if(asset.status==='ready'){
  if(!asset.analysisRef)throw Error('IMAGE_ANALYSIS_CHANGED');const record=ImageAnalysisRecordSchema.parse(await readNarrationJson(projects.store,asset.analysisRef,p+'/assets/'+assetId+'/analysis/'));
  if(record.schemaVersion!==5||record.assetId!==assetId||record.sha256!==input.sha256||record.mime!==input.mime||record.trust!=='untrusted_material')throw Error('IMAGE_ANALYSIS_CHANGED');guardImageUnderstanding(record.imageAnalysis,input);await fence();return asset;
 }
 const identity=canonicalHash(input),effectKey=p+'/assets/'+assetId+'/effects/image-understanding/'+identity;let prior:unknown;
 try{prior=(await projects.store.readFresh(effectKey)).value}catch(error){if(!(error instanceof StoreMissing))throw error}
 const env=options.env||process.env;let reservation:Awaited<ReturnType<typeof reserveModelBudget>>|undefined;
 if(prior===undefined&&!options.analyze){requireGeneration(readConfiguration(env));configuredModel('visual',env);reservation=await reserveModelBudget(projects.store,projectId,'image-'+assetId+'-'+identity,{inputTokens:Math.ceil(original.length*4/3)+Buffer.byteLength(JSON.stringify(input))+8192,outputTokens:4000},options.limits||modelLimits(env));await fence()}
 const raw=await runEffect(projects.store,effectKey,async()=>{await fence();if(options.analyze)return options.analyze(input,original,fence);if(!reservation)throw Error('IMAGE_EFFECT_CHANGED');requireGeneration(readConfiguration(env));return withAccountedModel(projects.store,reservation.reservation,()=>runImageUnderstanding(input,original,reservation.maxOutputTokens,env,{assertActive:fence}))});
 await fence();const imageAnalysis=guardImageUnderstanding(raw,input),text=imageAnalysisText(imageAnalysis);
 if(Buffer.byteLength(text)>40000)throw Error('IMAGE_ANALYSIS_INVALID');
 const record={schemaVersion:5,assetId,mime:input.mime,sha256:input.sha256,text,imageAnalysis,trust:'untrusted_material'},ref=await projects.index.immutable(p+'/assets/'+assetId+'/analysis/'+identity,record);await fence();
 const next=await updateJson(projects.store,key,async(c:ProjectControl)=>{
  if(c.deletedAt||!Number.isFinite(Date.parse(c.expiresAt))||Date.parse(c.expiresAt)<=Date.now())throw Error('ACCESS_NOT_FOUND');const a=c.assets.find(a=>a.id===assetId);
  if(!a||!['uploaded','analyzing','ready'].includes(a.status)||!a.rightsConfirmed||a.sha256!==input.sha256||a.bytes!==input.bytes||a.declaredMime!==input.mime||a.intendedUse!==input.intendedUse)throw Error('IMAGE_ASSET_CHANGED');
  if(a.status==='ready'){if(a.analysisRef?.sha256!==ref.sha256)throw Error('IMAGE_ANALYSIS_CHANGED');return c}
  const understanding=(await projects.store.readFresh<Understanding>(c.understandingRef.key)).value,briefVersion=c.briefVersion+1,updated={...understanding,briefVersion,assetUses:understanding.assetUses.filter(use=>use.assetId!==assetId).concat({assetId,purpose:a.intendedUse,required:false})},understandingRef=await projects.index.immutable(p+'/understanding/'+briefVersion+'/'+randomUUID(),updated),assets=c.assets.map(a=>a.id===assetId?{...a,status:'ready',analysisRef:ref,errorCode:undefined}:a);
  return{...c,controlVersion:c.controlVersion+1,briefVersion,understandingRef,assets,inputPending:assets.some(a=>['reserved','uploading','uploaded','analyzing'].includes(a.status)),previewState:c.previewState==='ready'?'stale':c.previewState};
 });await fence();return next.assets.find(a=>a.id===assetId)!;
}
