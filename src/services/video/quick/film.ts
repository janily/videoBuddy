import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {mkdir,mkdtemp,writeFile,rm,stat} from 'node:fs/promises';
import type {ProjectControl} from '@/contracts/video/project';
import type {VisualShotSource} from '@/contracts/video/visual-shot';
import {runQuickVisualShot,guardQuickVisualShot,quickClock,RejectedVisualSource} from '@/mastra/video/visual-shot';
import {configuredModel} from '@/mastra/video/model-adapter';
import {reserveModelBudget,modelLimits} from '@/services/video/budget/model-budget';
import {withAccountedModel} from '@/services/video/budget/model-call';
import {readConfiguration,requireGeneration,type Environment} from '@/services/video/config/environment';
import {canonicalHash,canonicalJson} from '@/services/video/domain/hash';
import {computeStageKey,type RenderedVideo} from '@/services/video/media/runtime';
import {createMediaRuntime} from '@/services/video/media/configuration';
import {selectedRuntimeAssets} from '@/services/video/media/runtime-assets';
import {LocalAssetBytes} from '@/services/video/assets/local-bytes';
import {loadMusicLibrary,pickTrack} from '@/services/video/music/library';
import {assertProductionFence} from '@/services/video/commands/production-fence';
import {createOrRead,StoreMissing,updateJson} from '@/services/video/storage/atomic-store';
import type {ProjectStore} from '@/services/video/storage/project-store';
import {saveScenePreview} from './scene-preview';
import {readQuickSettings,takeFor} from './settings';
import {quickTreatmentContext,readOrCreateTreatment,generateQuickTreatment} from './script';
import {saveShotProgress,publishShotArtifact} from './shot-media';
import {recordStepTiming} from './timings';

/**
 * The quick flow, end to end, in five steps:
 *   1 plan the story (one model call)  2 draw each shot (one model call per shot)
 *   3 render each shot (Chromium)       4 join the shots    5 add music + AI label
 * Every step is cached by its inputs, so changing the music or redrawing one shot
 * repeats only what changed. No narration, ASR, audio model, preview or approval.
 */
export interface QuickFilmInput{projectId:string;operationId:string;expectedConsentEpoch:number}
export interface QuickFilmOutput{outputPath:string;sha256:string;bytes:number;width:number;height:number;durationSec:number;styleSlug:string;aspect:'16:9'|'9:16';briefVersion:number;shots:Array<{id:string;scriptLine:string;startFrame:number;endFrame:number;take:number}>;fps:24|30|60;music:{trackId:string;title:string;license:string}|null}
export type Activity=(stage:string,label:string,progress?:{completed:number;total:number;unit:'shots'})=>Promise<void>;
export type ShotUpdate={shotId:string;state:'drawing'|'drawn'|'rendering'|'rendered';index:number;total:number};

async function cached<T>(projects:ProjectStore,key:string,make:()=>Promise<T>):Promise<T>{
 try{return (await projects.store.readFresh<{value:T}>(key)).value.value}catch(error){if(!(error instanceof StoreMissing))throw error}
 const value=await make();
 return (await createOrRead(projects.store,key,{value})).value;
}

export async function buildQuickFilm(projects:ProjectStore,input:QuickFilmInput,options:{root:string;env?:Environment;onShot?:(shot:ShotUpdate)=>Promise<void>},activity:Activity):Promise<QuickFilmOutput>{
 const env=options.env||process.env,{root}=options,{projectId,operationId,expectedConsentEpoch}=input,prefix=`projects/${projectId}`;
 requireGeneration(readConfiguration(env));configuredModel('director',env);configuredModel('visual',env);
 const control=(await projects.store.readFresh<ProjectControl>(`${prefix}/control`)).value;
 const baseline={briefVersion:control.briefVersion,understandingRef:control.understandingRef};
 const assertActive=async()=>assertProductionFence((await projects.store.readFresh<ProjectControl>(`${prefix}/control`)).value,projectId,operationId,expectedConsentEpoch,baseline);
 await assertActive();
 const runtime=await createMediaRuntime(root,env,{projectId,operationId});
 try{
 const context=await quickTreatmentContext(projects,control),{understanding,style,base,contextBytes}=context;
 const aspect=understanding.preferences.aspect,settings=await readQuickSettings(projects.store,projectId),limits=modelLimits(env);
 const operation=(await projects.store.readFresh<{revisionId:string}>(`${prefix}/operations/${operationId}`)).value;
 await updateJson(projects.store,`${prefix}/control`,(c:ProjectControl)=>{
  if(c.briefVersion!==understanding.briefVersion||c.activeProduction!==operationId)throw Error('PREVIEW_STALE');
  if(c.latestScript?.base===base)return c;
  return{...c,controlVersion:c.controlVersion+1,latestScript:{base,briefVersion:understanding.briefVersion,operationId}};
 });
 let timedStage='treatment',startedAt=Date.now();
 const step:Activity=async(stage,label,progress)=>{
  if(stage!==timedStage){await recordStepTiming(projects.store,projectId,timedStage as 'treatment'|'visual'|'picture'|'composition'|'music',Date.now()-startedAt,operationId);timedStage=stage;startedAt=Date.now()}
  await activity(stage,label,progress);
 };
 await step('treatment','正在构思故事和镜头');
 const treatment=await readOrCreateTreatment(projects,context,()=>generateQuickTreatment(projects,context,operationId,env,assertActive));
 const landscape=aspect==='16:9',hd=env.VIDEO_QUICK_RESOLUTION!=='720';
 const logicalWidth=landscape?1920:1080,logicalHeight=landscape?1080:1920,outputWidth=hd?logicalWidth:landscape?1280:720,outputHeight=hd?logicalHeight:landscape?720:1280;
 const total=treatment.shots.length,progress=(completed:number)=>({completed,total,unit:'shots' as const});
 await step('treatment','脚本已就绪',progress(total));
 const shotUpdate=async(shotId:string,state:ShotUpdate['state'],index:number,take:number)=>{
  await assertActive();await saveShotProgress(projects,base,shotId,{state,take,...(state==='drawn'?{sourceAvailable:true,sourceOperationId:operationId,sourceTake:take}:{})});await options.onShot?.({shotId,state,index,total});
 };

 // User images the brief says to use (logos, product photos).
 const imageAssets=control.assets.filter(asset=>asset.status==='ready'&&asset.rightsConfirmed&&['image/png','image/jpeg','image/webp'].includes(asset.declaredMime)&&understanding.assetUses.some(use=>use.assetId===asset.id)).map(asset=>({id:asset.id,mime:asset.declaredMime}));
 const clockHash=canonicalHash(quickClock(treatment)),seed=Number.parseInt(canonicalHash({projectId,briefVersion:understanding.briefVersion,kind:'quick-seed-v1'}).slice(0,8),16);
 const sources:VisualShotSource[]=[];
 for(const [index,shot] of treatment.shots.entries()){
  await step('visual',`正在画第 ${index+1}/${treatment.shots.length} 个镜头`,progress(index));
  const take=takeFor(settings,understanding.briefVersion,shot.id),continuitySource=index>0?sources[0]:undefined;
  await shotUpdate(shot.id,'drawing',index,take);
  const source=await cached(projects,`${base}/shots/${canonicalHash({shotId:shot.id}).slice(0,16)}/take-${take}`,async()=>{
   const draw=async(correction?:ConstructorParameters<typeof RejectedVisualSource>[0])=>{
    const inputBytes=contextBytes+Buffer.byteLength(canonicalJson({treatment,continuitySource:continuitySource??null,correction:correction??null}));
    const reservation=await reserveModelBudget(projects.store,projectId,`${operationId}-quick-visual-${randomUUID()}`,{inputTokens:inputBytes+4096,outputTokens:12000},limits);
    await assertActive();
    return withAccountedModel(projects.store,reservation.reservation,()=>runQuickVisualShot(understanding,treatment,shot.id,{env,seed,maxOutputTokens:reservation.maxOutputTokens,imageAssets,continuitySource,correction,assertActive}));
   };
   // One correction round when the model's source fails the static checks.
   try{return await draw()}catch(error){if(!(error instanceof RejectedVisualSource))throw error;return draw(error.correction)}
  });
  const guarded=guardQuickVisualShot(source,understanding,treatment,clockHash,seed);sources.push(guarded);
  await assertActive();await saveScenePreview(projects,{projectId,operationId,shotId:shot.id,take,width:logicalWidth,height:logicalHeight,fps:treatment.fps,source:guarded});
  await shotUpdate(shot.id,'drawn',index,take);
  await step('visual',`第 ${index+1}/${total} 个镜头已画好`,progress(index+1));
 }

 const clips:RenderedVideo[]=[];
 const cancel=new AbortController();let fenceError:unknown,polling=false;
 const monitor=setInterval(()=>{if(polling)return;polling=true;void assertActive().catch(error=>{fenceError=error;cancel.abort()}).finally(()=>{polling=false})},250);
 try{
 let completedShots=0;
 await step('picture','正在制作镜头片段',progress(0));
 await Promise.all(sources.map(async(source,index)=>{

  const entries=[];
  for(const id of source.assetIds){
   const asset=control.assets.find(a=>a.id===id);
   if(!asset||asset.status!=='ready'||!asset.rightsConfirmed||!asset.sha256||!asset.bytes)throw Error('VISUAL_ASSET_NOT_READY');
   const actual=await new LocalAssetBytes(root).inspect(projectId,id,asset.declaredMime);
   if(actual.sha256!==asset.sha256||actual.bytes!==asset.bytes)throw Error('RUNTIME_ASSET_CHANGED');
   entries.push({id,originalRef:{key:`assets/${projectId}/${id}.bin`,mime:actual.mime,sha256:actual.sha256,bytes:actual.bytes}});
  }
  const assets=selectedRuntimeAssets(projectId,source.assetIds,entries);
  const parameters={projectId,bundleHash:canonicalHash({kind:'quick-shot-v1',source:canonicalHash(source)}),runtimeDigest:runtime.runtimeDigest,sourceHtml:source.sourceHtml,logicalWidth,logicalHeight,outputWidth,outputHeight,fps:treatment.fps,startFrame:source.startFrame,endFrame:source.endFrame,seed,fence:0,...(assets.length?{assets}:{})};
  const stageKey=computeStageKey(parameters),take=takeFor(settings,understanding.briefVersion,source.shotId);
  const media={projectId,operationId,revisionId:operation.revisionId,base,shotId:source.shotId,take};
  await shotUpdate(source.shotId,'rendering',index,take);await assertActive();
  const clip=await runtime.renderShot({...parameters,operationId,attemptId:randomUUID(),stageKey},{signal:cancel.signal,onPoster:async bytes=>{
   await assertActive();await mkdir(join(root,'media'),{recursive:true,mode:0o2770});const directory=await mkdtemp(join(root,'media','poster-'));
   try{const path=join(directory,'poster.png');await writeFile(path,bytes,{mode:0o640});await publishShotArtifact(projects,root,{...media,path,mime:'image/png'},assertActive);await options.onShot?.({shotId:source.shotId,state:'drawn',index,total})}
   finally{await rm(directory,{recursive:true,force:true})}
  }});
  await assertActive();await publishShotArtifact(projects,root,{...media,path:clip.outputPath,mime:'video/mp4',expectedSha256:clip.sha256},assertActive);
  await options.onShot?.({shotId:source.shotId,state:'rendered',index,total});
  clips[index]=clip;completedShots++;
  await step('picture',`第 ${completedShots}/${total} 个片段已完成`,progress(completedShots));
 }));

 await step('composition','正在拼接镜头',progress(total));
 await step('music','正在配乐并保存 AI 生成标识',progress(total));
 const library=settings.music.mode==='off'?null:await loadMusicLibrary(env);
 const track=!library?undefined:settings.music.mode==='track'?library.tracks.find(t=>t.id===(settings.music as {trackId:string}).trackId):pickTrack(library,{styleSlug:style.id,text:[understanding.subject,...understanding.summary].join('\n'),durationSec:treatment.durationSec});
 if(settings.music.mode==='track'&&library&&!track)throw Error('MUSIC_TRACK_MISSING');
 const composed=await runtime.assemble({projectId,clips,music:track?{path:track.path,trackId:track.id,sha256:track.sha256,bytes:(await stat(track.path)).size}:null,title:understanding.subject||'VideoBuddy'},{signal:cancel.signal});
 await assertActive();
 await recordStepTiming(projects.store,projectId,'music',Date.now()-startedAt,operationId);
 return{outputPath:composed.outputPath,sha256:composed.sha256,bytes:composed.bytes,width:outputWidth,height:outputHeight,durationSec:treatment.durationSec,fps:treatment.fps,styleSlug:style.id,aspect,briefVersion:understanding.briefVersion,
  shots:treatment.shots.map(shot=>({id:shot.id,scriptLine:shot.scriptLine,startFrame:shot.startFrame,endFrame:shot.endFrame,take:takeFor(settings,understanding.briefVersion,shot.id)})),
  music:track?{trackId:track.id,title:track.title,license:track.license}:null};
 }catch(error){throw fenceError||error}finally{clearInterval(monitor);cancel.abort()}
 }finally{await runtime.close()}
}
