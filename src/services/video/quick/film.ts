import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import type {ProjectControl} from '@/contracts/video/project';
import type {VisualShotSource} from '@/contracts/video/visual-shot';
import {runQuickVisualShot,guardQuickVisualShot,quickClock,RejectedVisualSource} from '@/mastra/video/visual-shot';
import {configuredModel} from '@/mastra/video/model-adapter';
import {reserveModelBudget,modelLimits} from '@/services/video/budget/model-budget';
import {withAccountedModel} from '@/services/video/budget/model-call';
import {readConfiguration,requireGeneration,type Environment} from '@/services/video/config/environment';
import {canonicalHash,canonicalJson} from '@/services/video/domain/hash';
import {computeStageKey,DockerExecutor,dockerConfiguration} from '@/services/video/media/docker-executor';
import type {MediaJob} from '@/services/video/media/executor';
import {technicalVideoQa} from '@/services/video/media/technical-qa';
import {assemblePictureSequence} from '@/services/video/media/picture-sequence';
import {selectedRuntimeAssets} from '@/services/video/media/runtime-assets';
import {LocalAssetBytes} from '@/services/video/assets/local-bytes';
import {loadMusicLibrary,pickTrack} from '@/services/video/music/library';
import {assertPreviewProductionFence} from '@/services/video/preview/fence';
import {createOrRead,StoreMissing,updateJson} from '@/services/video/storage/atomic-store';
import type {ProjectStore} from '@/services/video/storage/project-store';
import {composeQuickFilm} from './compose';
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
export type ShotUpdate={shotId:string;state:'drawing'|'drawn'|'rendered';index:number;total:number};

async function cached<T>(projects:ProjectStore,key:string,make:()=>Promise<T>):Promise<T>{
 try{return (await projects.store.readFresh<{value:T}>(key)).value.value}catch(error){if(!(error instanceof StoreMissing))throw error}
 const value=await make();
 return (await createOrRead(projects.store,key,{value})).value;
}

export async function buildQuickFilm(projects:ProjectStore,input:QuickFilmInput,options:{root:string;env?:Environment;onShot?:(shot:ShotUpdate)=>Promise<void>},activity:Activity):Promise<QuickFilmOutput>{
 const env=options.env||process.env,{root}=options,{projectId,operationId,expectedConsentEpoch}=input,prefix=`projects/${projectId}`;
 requireGeneration(readConfiguration(env));configuredModel('director',env);configuredModel('visual',env);dockerConfiguration(env,operationId);
 const control=(await projects.store.readFresh<ProjectControl>(`${prefix}/control`)).value;
 const baseline={briefVersion:control.briefVersion,understandingRef:control.understandingRef};
 const assertActive=async()=>assertPreviewProductionFence((await projects.store.readFresh<ProjectControl>(`${prefix}/control`)).value,projectId,operationId,expectedConsentEpoch,baseline);
 await assertActive();
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
 const total=treatment.shots.length,progress=(completed:number)=>({completed,total,unit:'shots' as const});
 await step('treatment','脚本已就绪',progress(total));
 const shotUpdate=async(shotId:string,state:ShotUpdate['state'],index:number,take:number)=>{
  await assertActive();await saveShotProgress(projects,base,shotId,{state,take});await options.onShot?.({shotId,state,index,total});
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
  sources.push(guardQuickVisualShot(source,understanding,treatment,clockHash,seed));
  await shotUpdate(shot.id,'drawn',index,take);
  await step('visual',`第 ${index+1}/${total} 个镜头已画好`,progress(index+1));
 }

 const landscape=aspect==='16:9',hd=env.VIDEO_QUICK_RESOLUTION!=='720';
 const logicalWidth=landscape?1920:1080,logicalHeight=landscape?1080:1920,outputWidth=hd?logicalWidth:landscape?1280:720,outputHeight=hd?logicalHeight:landscape?720:1280;
 const config=dockerConfiguration(env,operationId),clips=[];
 for(const [index,source] of sources.entries()){
  await step('picture',`正在制作第 ${index+1}/${sources.length} 个片段`,progress(index));
  const entries=[];
  for(const id of source.assetIds){
   const asset=control.assets.find(a=>a.id===id);
   if(!asset||asset.status!=='ready'||!asset.rightsConfirmed||!asset.sha256||!asset.bytes)throw Error('VISUAL_ASSET_NOT_READY');
   const actual=await new LocalAssetBytes(root).inspect(projectId,id,asset.declaredMime);
   if(actual.sha256!==asset.sha256||actual.bytes!==asset.bytes)throw Error('RUNTIME_ASSET_CHANGED');
   entries.push({id,originalRef:{key:`assets/${projectId}/${id}.bin`,mime:actual.mime,sha256:actual.sha256,bytes:actual.bytes}});
  }
  const assets=selectedRuntimeAssets(projectId,source.assetIds,entries);
  const parameters={projectId,bundleHash:canonicalHash({kind:'quick-shot-v1',source:canonicalHash(source)}),runtimeDigest:config.runtimeDigest,sourceHtml:source.sourceHtml,logicalWidth,logicalHeight,outputWidth,outputHeight,fps:treatment.fps,startFrame:source.startFrame,endFrame:source.endFrame,seed,fence:0,...(assets.length?{assets}:{})};
  const stageKey=computeStageKey(parameters),stageDir=join(root,'media',stageKey),expected={width:outputWidth,height:outputHeight,durationSec:(source.endFrame-source.startFrame)/treatment.fps,fps:treatment.fps,audio:false};
  const take=takeFor(settings,understanding.briefVersion,source.shotId);
  const media={projectId,operationId,revisionId:operation.revisionId,base,shotId:source.shotId,take};
  let posterSaved=false;
  const savePoster=async()=>{
   if(posterSaved)return;
   try{await publishShotArtifact(projects,root,{...media,path:join(stageDir,'output/poster.png'),mime:'image/png'},assertActive);posterSaved=true;await options.onShot?.({shotId:source.shotId,state:'drawn',index,total})}
   catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error}
  };
  let qa=await technicalVideoQa(stageDir,config.image,'output/picture.mp4',expected).catch(()=>null);
  if(!qa){
   const executor=new DockerExecutor(root,env,{assertActive}),job:MediaJob={...parameters,operationId,attemptId:`quick-${stageKey.slice(0,12)}`,stageKey};
   const handle=await executor.submit(job),deadline=Date.now()+config.timeoutSeconds*1000+30000;
   let status=await executor.inspect(handle);
   while(status.status==='running'&&Date.now()<deadline){
    try{await assertActive()}catch(error){await executor.cancel(handle).catch(()=>undefined);throw error}
    await savePoster();await new Promise(resolve=>setTimeout(resolve,1000));status=await executor.inspect(handle);
   }
   if(status.status!=='succeeded')throw Error(`PICTURE_RENDER_FAILED: ${status.errorCode||status.status}`);
   qa=await technicalVideoQa(stageDir,config.image,'output/picture.mp4',expected);
  }
  await savePoster();
  await publishShotArtifact(projects,root,{...media,path:join(stageDir,'output/picture.mp4'),mime:'video/mp4',expectedSha256:qa.sha256},assertActive);
  await options.onShot?.({shotId:source.shotId,state:'rendered',index,total});
  await step('picture',`第 ${index+1}/${total} 个片段已完成`,progress(index+1));
  clips.push({shotId:source.shotId,startFrame:source.startFrame,endFrame:source.endFrame,stageKey,sha256:qa.sha256});
 }

 await step('composition','正在拼接镜头',progress(total));
 const sequence=await assemblePictureSequence(root,{projectId,revisionId:`quick-${understanding.briefVersion}`,shots:clips,width:outputWidth,height:outputHeight,fps:treatment.fps,runtimeDigest:config.runtimeDigest,fence:0},env,{assertActive});

 await step('music','正在配乐并加上 AI 生成标识',progress(total));
 const library=settings.music.mode==='off'?null:await loadMusicLibrary(env);
 const track=!library?undefined:settings.music.mode==='track'?library.tracks.find(t=>t.id===(settings.music as {trackId:string}).trackId):pickTrack(library,{styleSlug:style.id,text:[understanding.subject,...understanding.summary].join('\n'),durationSec:treatment.durationSec});
 if(settings.music.mode==='track'&&library&&!track)throw Error('MUSIC_TRACK_MISSING');
 const composed=await composeQuickFilm(root,{picturePath:sequence.outputPath,music:track?{path:track.path,trackId:track.id}:null,width:outputWidth,height:outputHeight,fps:treatment.fps,durationSec:treatment.durationSec,title:understanding.subject||'VideoBuddy'},env,{assertActive});
 await assertActive();
 await recordStepTiming(projects.store,projectId,'music',Date.now()-startedAt,operationId);
 return{outputPath:composed.outputPath,sha256:composed.qa.sha256,bytes:composed.qa.bytes,width:outputWidth,height:outputHeight,durationSec:treatment.durationSec,fps:treatment.fps,styleSlug:style.id,aspect,briefVersion:understanding.briefVersion,
  shots:treatment.shots.map(shot=>({id:shot.id,scriptLine:shot.scriptLine,startFrame:shot.startFrame,endFrame:shot.endFrame,take:takeFor(settings,understanding.briefVersion,shot.id)})),
  music:track?{trackId:track.id,title:track.title,license:track.license}:null};
}
