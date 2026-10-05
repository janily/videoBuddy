import {readBookTimingFont,assertBookCaptionGlyphs,isBookTimingFont,bookFontVersion} from '../audio/book-font';
import {isAbsolute} from 'node:path';
import {z} from 'zod';
import {ObjectRefSchema,UnderstandingSchema,type ObjectRef} from '@/contracts/video/domain';
import {FilmSpecSchema,FilmTimelineSchema} from '@/contracts/video/film';
import {loadVerifiedFilmPackage,AssetManifestSchema,AudioManifestSchema,SourceManifestSchema,TreatmentSchema,FactsManifestSchema,expectedCaptionPackage,SourceCodeSchema} from '@/contracts/video/film-package';
import {guardTreatment} from '@/contracts/video/treatment';
import {guardAudioPlan,compileAudioCues} from '@/contracts/video/audio-plan';
import {CompleteVisualShotSchema} from '@/contracts/video/visual-shot';
import type {ProjectControl} from '@/contracts/video/project';
import {LocalAssetBytes} from '@/services/video/assets/local-bytes';
import {readNarrationJson} from '@/services/video/audio/narration-package';
import {loadAudioExecution,archiveSynthSources} from '@/services/video/audio/execution-package';
import {prepareAudioExecutionStage} from './audio-execution-stage';
import {readPinnedSubtitleFont} from '@/services/video/audio/subtitles';
import type {Environment} from '@/services/video/config/environment';
import {canonicalHash,canonicalJson} from '@/services/video/domain/hash';
import {dockerConfiguration} from '@/services/video/media/docker-executor';
import {mandatoryDeliveryRules,type DeliveryPolicy} from '@/services/video/quality/delivery';
import {createOrRead,StoreMissing} from '@/services/video/storage/atomic-store';
import type {ProjectStore} from '@/services/video/storage/project-store';
import {getStyle} from '@/services/video/styles/registry';
import {revisionSeed} from '@/services/video/timeline/seed';
import {filmPackagePolicyVersion,bookFilmPackagePolicyVersion,clearBookFilmPackagePolicyVersion,captionStyleId,frozenCaptions,narrationSilence} from '@/services/video/timeline/package';
import {prepareAudioPlanStage} from './audio-plan-stage';
import {assertPreviewProductionFence} from './fence';
import {NarrationPackageDataSchema,prepareNarrationPackageStage} from './narration-package-stage';
import {TimingDraftSchema} from './timing-draft';
import {prepareTimingStage} from './timing-stage';
import {prepareVisualShotStage} from './visual-stage';

const RecordSchema=z.strictObject({schemaVersion:z.literal(2),briefVersion:z.number().int().nonnegative(),filmSpecRef:ObjectRefSchema,qualityPolicyRef:ObjectRefSchema,qualityStatus:z.literal('semantic_not_checked')});
export type FilmPackageStageRecord=z.infer<typeof RecordSchema>;
interface Options{root?:string;env?:Environment;readFont?:()=>ReturnType<typeof readPinnedSubtitleFont>;mustExist?:boolean}

// Assembly consumes existing model/runtime stages. It never launches a model, renderer or paid effect.
export async function prepareFilmPackageStage(projects:ProjectStore,projectId:string,revisionId:string,operationId:string,expectedConsentEpoch:number,treatmentRef:ObjectRef,options:Options={}):Promise<FilmPackageStageRecord>{
 if(![projectId,revisionId,operationId].every(id=>z.uuid().safeParse(id).success)||!Number.isSafeInteger(expectedConsentEpoch)||expectedConsentEpoch<0)throw Error('VALIDATION_FAILED');
 const env=options.env||process.env,root=options.root||env.VIDEO_DATA_DIR;
 if(!root||!isAbsolute(root))throw Error('CONFIGURATION_REQUIRED: VIDEO_DATA_DIR');
 const prefix=`projects/${projectId}`,revisionPrefix=`${prefix}/revisions/${revisionId}/`,key=`${revisionPrefix}film-package-v2-stage`;
 const control=(await projects.store.readFresh<ProjectControl>(`${prefix}/control`)).value;
 assertPreviewProductionFence(control,projectId,operationId,expectedConsentEpoch);
 let existing:unknown;
 try{existing=(await projects.store.readFresh<unknown>(key)).value}catch(error){if(!(error instanceof StoreMissing))throw error}
 if(existing===undefined&&options.mustExist)throw Error('FILM_PACKAGE_MISSING');
 let policyVersion=existing===undefined?filmPackagePolicyVersion:FilmSpecSchema.parse(await readNarrationJson(projects.store,RecordSchema.parse(existing).filmSpecRef,`${revisionPrefix}film/`)).qualityPolicyVersion;
 const understanding=UnderstandingSchema.parse(await readNarrationJson(projects.store,control.understandingRef,`${prefix}/understanding/`));
 if(understanding.briefVersion!==control.briefVersion||!understanding.preferences.styleSlug)throw Error('FILM_BRIEF_CHANGED');
 const style=getStyle(understanding.preferences.styleSlug),treatment=guardTreatment(await readNarrationJson(projects.store,treatmentRef,`${revisionPrefix}treatment-plan/`),understanding,style.rulesHash);
 const timingRecord=await prepareTimingStage(projects,projectId,revisionId,operationId,expectedConsentEpoch,treatmentRef,{root,env,mustExist:true});
 const timing=TimingDraftSchema.parse(await readNarrationJson(projects.store,timingRecord.draftRef,`${revisionPrefix}timing-draft/`));
 if(existing===undefined&&isBookTimingFont(timing.font))policyVersion=timing.font.family==='Crayon Book Clear Handwriting'?clearBookFilmPackagePolicyVersion:bookFilmPackagePolicyVersion;
 const audioRecord=await prepareAudioPlanStage(projects,projectId,revisionId,operationId,expectedConsentEpoch,treatmentRef,{root,env,mustExist:true}),seed=revisionSeed(projectId,revisionId);
 const audio=guardAudioPlan(await readNarrationJson(projects.store,audioRecord.planRef,`${revisionPrefix}audio-plan/`),understanding,treatment,timing,timingRecord.draftRef.sha256,seed);
 const runtime=dockerConfiguration(env,operationId);
 if(runtime.runtimeDigest!==timing.track.runtimeDigest||timing.font&&timing.font.runtimeDigest!==runtime.runtimeDigest)throw Error('FILM_RUNTIME_CHANGED');
 let executionRef:ObjectRef|undefined;
 try{executionRef=(await prepareAudioExecutionStage(projects,projectId,revisionId,operationId,expectedConsentEpoch,treatmentRef,{root,env,mustExist:true})).packageRef}
 catch(error){if((error as Error).message!=='AUDIO_EXECUTION_MISSING')throw error;if(audio.music.length||audio.foley.length||audio.mix.voiceGainDb!==0)throw Error('FILM_AUDIO_EXECUTION_NOT_READY')}
 const executed=executionRef?await loadAudioExecution(projects.store,root,projectId,revisionId,executionRef,audioRecord.planRef,timingRecord.draftRef):null;
 if(isBookTimingFont(timing.font)){
  const actual=await readBookTimingFont(env,{version:bookFontVersion(timing.font),assertActive:async()=>assertPreviewProductionFence((await projects.store.readFresh<ProjectControl>(`${prefix}/control`)).value,projectId,operationId,expectedConsentEpoch,{briefVersion:control.briefVersion,understandingRef:control.understandingRef}),journal:{store:projects.store,prefix:`${prefix}/operations/${operationId}/media-effects`}});
  if(canonicalHash(actual.font)!==canonicalHash(timing.font))throw Error('FILM_FONT_CHANGED');assertBookCaptionGlyphs(timing.captions.map(c=>c.text),actual.glyphsById,bookFontVersion(timing.font));
 }else if(timing.font){
  const font=await (options.readFont||(()=>readPinnedSubtitleFont(env)))();
  if(font.family!==timing.font.family||font.runtimeDigest!==timing.font.runtimeDigest||font.charsetSha256!==timing.font.charsetSha256||timing.captions.some(cue=>[...cue.text].some(char=>!/\s/.test(char)&&!font.glyphs.has(char))))throw Error('FILM_FONT_CHANGED');
 }
 const narrationRecord=await prepareNarrationPackageStage(projects,projectId,revisionId,operationId,expectedConsentEpoch,treatmentRef,{root,env,mustExist:true});
 const narration=NarrationPackageDataSchema.parse(await readNarrationJson(projects.store,narrationRecord.packageRef,`${revisionPrefix}narration-package/`));
 const pending:Array<{prefix:string;value:unknown;ref:ObjectRef}>=[];
 function document(name:string,value:unknown):ObjectRef{
  const target=`${revisionPrefix}${name}`,sha256=canonicalHash(value),ref={key:`${target}/${sha256}`,sha256,bytes:Buffer.byteLength(canonicalJson(value)),mime:'application/json'};
  pending.push({prefix:target,value,ref});return ref;
 }
 const assetEntries=[];
 for(const use of understanding.assetUses){
  const asset=control.assets.find(asset=>asset.id===use.assetId);
  if(!asset||asset.status!=='ready'||!asset.rightsConfirmed||!asset.analysisRef||!asset.sha256||!asset.bytes)throw Error('FILM_ASSET_NOT_READY');
  const actual=await new LocalAssetBytes(root).inspect(projectId,asset.id,asset.declaredMime);
  if(actual.sha256!==asset.sha256||actual.bytes!==asset.bytes)throw Error('FILM_ASSET_INVALID');
  assetEntries.push({id:asset.id,analysisRef:asset.analysisRef,usage:use.purpose,originalRef:{key:`assets/${projectId}/${asset.id}.bin`,sha256:actual.sha256,bytes:actual.bytes,mime:actual.mime},rightsRef:document(`asset-rights/${asset.id}`,{basis:'user_supplied',source:`User confirmed upload rights for asset ${asset.id}`})});
 }
 const modules=[],actors=new Map<string,string>(),shots=[];
 for(const shot of treatment.shots){
  const record=await prepareVisualShotStage(projects,projectId,revisionId,operationId,expectedConsentEpoch,treatmentRef,shot.id,{root,env,mustExist:true});
  const raw=await readNarrationJson(projects.store,record.sourceRef,`${revisionPrefix}visual-source/`),parsed=CompleteVisualShotSchema.safeParse(raw);
  if(!parsed.success)throw Error('FILM_VISUAL_SOURCE_INCOMPLETE');
  const visual=parsed.data,moduleId=`module-${canonicalHash({shotId:shot.id}).slice(0,24)}`;
  modules.push({id:moduleId,sourceRef:document(`source-modules/${moduleId}`,SourceCodeSchema.parse({html:visual.sourceHtml,visualSourceRef:record.sourceRef,timingDraftRef:timingRecord.draftRef}))});
  for(const id of visual.direction.actorIds)if(!actors.has(id))actors.set(id,moduleId);
  shots.push({id:shot.id,startFrame:shot.startFrame,endFrame:shot.endFrame,...visual.direction,sourceModule:moduleId,transitionIn:{kind:'cut' as const,overlapFrames:0},transitionOut:{kind:'cut' as const,overlapFrames:0},factIds:shot.factIds});
 }
 const landscape=understanding.preferences.aspect==='16:9',logicalOutput={width:landscape?1920:1080,height:landscape?1080:1920};
 const captions=frozenCaptions(timing,treatment),captionStyles=captions.length?[{id:captionStyleId,styleRef:document('caption-styles',expectedCaptionPackage(timing.font,logicalOutput,policyVersion))}]:[];
 const facts=FactsManifestSchema.parse({schemaVersion:1,facts:understanding.facts.filter(fact=>['provided','confirmed'].includes(fact.status))});
 const soundSources=executed?await archiveSynthSources(projects,projectId,revisionId,audioRecord.planRef,audio,runtime.runtimeDigest):[];
 const manifests={
  treatment:TreatmentSchema.parse({schemaVersion:1,summary:treatment.summary,script:treatment.script,factIds:[...new Set(treatment.shots.flatMap(shot=>shot.factIds))],planRef:treatmentRef}),facts,
  timeline:FilmTimelineSchema.parse({totalFrames:timing.totalFrames,fps:timing.fps,sampleRate:48000,sections:audio.sections,shots,cues:compileAudioCues(audio,timing.fps),narration:narration.lines,music:audio.music,foley:audio.foley,captions,intentionalBlackRanges:[],intentionalSilenceRanges:[...audio.intentionalSilenceRanges,...narrationSilence(narration.lines,timing.durationMs*48)]}),
  assets:AssetManifestSchema.parse({schemaVersion:1,assets:assetEntries}),
  sources:SourceManifestSchema.parse({schemaVersion:1,modules,actors:[...actors].map(([id,sourceModuleId])=>({id,sourceModuleId})),captionStyles}),
  audio:AudioManifestSchema.parse({schemaVersion:1,sources:[...narration.sources,...soundSources],buses:[{id:'voice'},{id:'music'},{id:'foley'}],planRef:audioRecord.planRef,timingDraftRef:timingRecord.draftRef,...(executionRef?{executionRef}:{})}),
 };
 const spec=FilmSpecSchema.parse({schemaVersion:5,projectId,revisionId,briefVersion:control.briefVersion,style:{slug:style.slug,packVersion:style.packVersion,upstreamCommit:style.upstreamCommit},output:{width:landscape?1920:1080,height:landscape?1080:1920,fps:timing.fps,totalFrames:timing.totalFrames,sampleRate:48000},seed,understandingRef:control.understandingRef,
  treatmentRef:document('treatment',manifests.treatment),factsRef:document('facts',facts),timelineRef:document('timeline',manifests.timeline),assetManifestRef:document('asset-manifest',manifests.assets),sourceManifestRef:document('source-manifest',manifests.sources),audioManifestRef:document('audio-manifest',manifests.audio),runtimeDigest:runtime.runtimeDigest,qualityPolicyVersion:policyVersion});
 const policy:DeliveryPolicy={schemaVersion:1,audioIntent:narration.lines.length?'voiced':audio.music.length||audio.foley.length?'music':'silent',captions:Boolean(captions.length),requiredRules:[...mandatoryDeliveryRules]};
 const expected=RecordSchema.parse({schemaVersion:2,briefVersion:control.briefVersion,filmSpecRef:document('film',spec),qualityPolicyRef:document('quality-policy',policy),qualityStatus:'semantic_not_checked'});
 async function fence(){
  const latest=(await projects.store.readFresh<ProjectControl>(`${prefix}/control`)).value;
  assertPreviewProductionFence(latest,projectId,operationId,expectedConsentEpoch,{briefVersion:control.briefVersion,understandingRef:control.understandingRef});
  if(canonicalHash(latest.assets)!==canonicalHash(control.assets))throw Error('FILM_ASSET_CHANGED');
 }
 async function verify(raw:unknown){
  const record=RecordSchema.safeParse(raw);
  if(!record.success||canonicalHash(record.data)!==canonicalHash(expected))throw Error('FILM_PACKAGE_CONFLICT');
  const storedSpec=await readNarrationJson(projects.store,record.data.filmSpecRef,`${revisionPrefix}film/`);
  if(canonicalHash(storedSpec)!==canonicalHash(spec))throw Error('FILM_PACKAGE_CONFLICT');
  await loadVerifiedFilmPackage(projects.store,storedSpec,root);
  await readNarrationJson(projects.store,record.data.qualityPolicyRef,`${revisionPrefix}quality-policy/`);
  await fence();return record.data;
 }
 if(existing!==undefined)return verify(existing);
 await fence();
 for(const entry of pending){const actual=await projects.index.immutable(entry.prefix,entry.value);if(canonicalHash(actual)!==canonicalHash(entry.ref))throw Error('FILM_REF_CHANGED')}
 await verify(expected); // No durable stage marker until the entire immutable graph is verified.
 await fence();return verify(await createOrRead(projects.store,key,expected));
}
