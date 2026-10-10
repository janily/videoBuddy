import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {UnderstandingSchema,type Understanding} from '@/contracts/video/domain';
import type {ProjectControl} from '@/contracts/video/project';
import {guardTreatment,type TreatmentPlan} from '@/contracts/video/treatment';
import type {VisualShotSource} from '@/contracts/video/visual-shot';
import {runTreatment} from '@/mastra/video/treatment';
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
import {createOrRead,StoreMissing} from '@/services/video/storage/atomic-store';
import type {ProjectStore} from '@/services/video/storage/project-store';
import {loadStageKnowledge} from '@/services/video/styles/knowledge-loader';
import {getStyle} from '@/services/video/styles/registry';
import {composeQuickFilm} from './compose';
import {readQuickSettings,takeFor} from './settings';

/**
 * The quick flow, end to end, in five steps:
 *   1 plan the story (one model call)  2 draw each shot (one model call per shot)
 *   3 render each shot (Chromium)       4 join the shots    5 add music + AI label
 * Every step is cached by its inputs, so changing the music or redrawing one shot
 * repeats only what changed. No narration, ASR, audio model, preview or approval.
 */
export interface QuickFilmInput{projectId:string;operationId:string;expectedConsentEpoch:number}
export interface QuickFilmOutput{outputPath:string;sha256:string;bytes:number;width:number;height:number;durationSec:number;styleSlug:string;aspect:'16:9'|'9:16';briefVersion:number;shots:Array<{id:string;scriptLine:string;startFrame:number;endFrame:number;take:number}>;fps:24|30|60;music:{trackId:string;title:string;license:string}|null}
type Activity=(stage:string,label:string)=>Promise<void>;

async function cached<T>(projects:ProjectStore,key:string,make:()=>Promise<T>):Promise<T>{
 try{return (await projects.store.readFresh<{value:T}>(key)).value.value}catch(error){if(!(error instanceof StoreMissing))throw error}
 const value=await make();
 return (await createOrRead(projects.store,key,{value})).value;
}

export async function buildQuickFilm(projects:ProjectStore,input:QuickFilmInput,options:{root:string;env?:Environment},activity:Activity):Promise<QuickFilmOutput>{
 const env=options.env||process.env,{root}=options,{projectId,operationId,expectedConsentEpoch}=input,prefix=`projects/${projectId}`;
 requireGeneration(readConfiguration(env));configuredModel('director',env);configuredModel('visual',env);dockerConfiguration(env,operationId);
 const control=(await projects.store.readFresh<ProjectControl>(`${prefix}/control`)).value;
 const baseline={briefVersion:control.briefVersion,understandingRef:control.understandingRef};
 const assertActive=async()=>assertPreviewProductionFence((await projects.store.readFresh<ProjectControl>(`${prefix}/control`)).value,projectId,operationId,expectedConsentEpoch,baseline);
 await assertActive();
 const stored:Understanding=UnderstandingSchema.parse((await projects.store.readFresh(control.understandingRef.key)).value);
 if(canonicalHash(stored)!==control.understandingRef.sha256)throw Error('PREVIEW_STALE');
 // Quick films carry no narration or captions; music is mixed in from the library at the end.
 const understanding:Understanding={...stored,preferences:{...stored.preferences,voiceMode:'none',musicMode:'none',captions:'none'}};
 const style=getStyle(understanding.preferences.styleSlug!),knowledge=await loadStageKnowledge(style.slug,'style');
 const aspect=understanding.preferences.aspect,settings=await readQuickSettings(projects.store,projectId),limits=modelLimits(env);
 // Everything below is keyed by the brief, style and aspect: same inputs, same cached result.
 const base=`${prefix}/quick/b${understanding.briefVersion}/${canonicalHash({understanding:control.understandingRef.sha256,style:knowledge.sha256}).slice(0,16)}`;

 await activity('treatment','正在构思故事和镜头');
 const contextBytes=Buffer.byteLength(canonicalJson({understanding,styleRules:knowledge.rules}));
 if(contextBytes>100000)throw Error('CONTEXT_LIMIT');
 const treatment:TreatmentPlan=guardTreatment(await cached(projects,`${base}/treatment`,async()=>{
  const reservation=await reserveModelBudget(projects.store,projectId,`${operationId}-quick-treatment-${randomUUID()}`,{inputTokens:contextBytes+4096,outputTokens:5000},limits);
  await assertActive();
  return withAccountedModel(projects.store,reservation.reservation,()=>runTreatment(understanding,reservation.maxOutputTokens,env));
 }),understanding,knowledge.sha256);

 // User images the brief says to use (logos, product photos).
 const imageAssets=control.assets.filter(asset=>asset.status==='ready'&&asset.rightsConfirmed&&['image/png','image/jpeg','image/webp'].includes(asset.declaredMime)&&understanding.assetUses.some(use=>use.assetId===asset.id)).map(asset=>({id:asset.id,mime:asset.declaredMime}));
 const clockHash=canonicalHash(quickClock(treatment)),seed=Number.parseInt(canonicalHash({projectId,briefVersion:understanding.briefVersion,kind:'quick-seed-v1'}).slice(0,8),16);
 const sources:VisualShotSource[]=[];
 for(const [index,shot] of treatment.shots.entries()){
  await activity('visual',`正在画第 ${index+1}/${treatment.shots.length} 个镜头`);
  const take=takeFor(settings,understanding.briefVersion,shot.id),continuitySource=index>0?sources[0]:undefined;
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
 }

 const landscape=aspect==='16:9',hd=env.VIDEO_QUICK_RESOLUTION!=='720';
 const logicalWidth=landscape?1920:1080,logicalHeight=landscape?1080:1920,outputWidth=hd?logicalWidth:landscape?1280:720,outputHeight=hd?logicalHeight:landscape?720:1280;
 const config=dockerConfiguration(env,operationId),clips=[];
 for(const [index,source] of sources.entries()){
  await activity('picture',`正在渲染第 ${index+1}/${sources.length} 个镜头`);
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
  let qa=await technicalVideoQa(stageDir,config.image,'output/picture.mp4',expected).catch(()=>null);
  if(!qa){
   const executor=new DockerExecutor(root,env,{assertActive}),job:MediaJob={...parameters,operationId,attemptId:`quick-${stageKey.slice(0,12)}`,stageKey};
   const handle=await executor.submit(job),deadline=Date.now()+config.timeoutSeconds*1000+30000;
   let status=await executor.inspect(handle);
   while(status.status==='running'&&Date.now()<deadline){
    try{await assertActive()}catch(error){await executor.cancel(handle).catch(()=>undefined);throw error}
    await new Promise(resolve=>setTimeout(resolve,1000));status=await executor.inspect(handle);
   }
   if(status.status!=='succeeded')throw Error(`PICTURE_RENDER_FAILED: ${status.errorCode||status.status}`);
   qa=await technicalVideoQa(stageDir,config.image,'output/picture.mp4',expected);
  }
  clips.push({shotId:source.shotId,startFrame:source.startFrame,endFrame:source.endFrame,stageKey,sha256:qa.sha256});
 }

 await activity('composition','正在拼接镜头');
 const sequence=await assemblePictureSequence(root,{projectId,revisionId:`quick-${understanding.briefVersion}`,shots:clips,width:outputWidth,height:outputHeight,fps:treatment.fps,runtimeDigest:config.runtimeDigest,fence:0},env,{assertActive});

 await activity('music','正在配乐并加上 AI 生成标识');
 const library=settings.music.mode==='off'?null:await loadMusicLibrary(env);
 const track=!library?undefined:settings.music.mode==='track'?library.tracks.find(t=>t.id===(settings.music as {trackId:string}).trackId):pickTrack(library,{styleSlug:style.id,text:[understanding.subject,...understanding.summary].join('\n'),durationSec:treatment.durationSec});
 if(settings.music.mode==='track'&&library&&!track)throw Error('MUSIC_TRACK_MISSING');
 const composed=await composeQuickFilm(root,{picturePath:sequence.outputPath,music:track?{path:track.path,trackId:track.id}:null,width:outputWidth,height:outputHeight,fps:treatment.fps,durationSec:treatment.durationSec,title:understanding.subject||'VideoBuddy'},env,{assertActive});
 await assertActive();
 return{outputPath:composed.outputPath,sha256:composed.qa.sha256,bytes:composed.qa.bytes,width:outputWidth,height:outputHeight,durationSec:treatment.durationSec,fps:treatment.fps,styleSlug:style.id,aspect,briefVersion:understanding.briefVersion,
  shots:treatment.shots.map(shot=>({id:shot.id,scriptLine:shot.scriptLine,startFrame:shot.startFrame,endFrame:shot.endFrame,take:takeFor(settings,understanding.briefVersion,shot.id)})),
  music:track?{trackId:track.id,title:track.title,license:track.license}:null};
}
