import {frozenBookFontHashes} from '@/services/video/audio/book-font-receipt';
import {LegacyTimingFontSchema,BookTimingFontSchema} from '@/services/video/audio/book-font';
import {bookCaptionRendererSha256,bookCaptionProducerSha256} from '@/services/video/media/book-caption-layer';
import{z}from'zod';
import{FactSchema,ObjectRefSchema,UnderstandingSchema,type ObjectRef}from'./domain';
import{FilmSpecSchema,FilmTimelineSchema,validateFilmSpec,validateFilmTimeline,type TimelineReferences}from'./film';
import{guardTreatment}from'./treatment';
import{canonicalHash,canonicalJson}from'@/services/video/domain/hash';
import type{AtomicStore}from'@/services/video/storage/atomic-store';
import{getStyle}from'@/services/video/styles/registry';
import{loadPackagedNarration}from'@/services/video/audio/narration-package';
import{loadAudioExecution,synthSourceDocuments}from'@/services/video/audio/execution-package';
import{compileVoicePlan}from'@/services/video/preview/voice-plan';
import{guardAudioPlan,compileAudioCues}from'./audio-plan';
import{CompleteVisualShotSchema,guardVisualShot}from'./visual-shot';
import{TimingDraftSchema}from'@/services/video/preview/timing-draft';
import{revisionSeed}from'@/services/video/timeline/seed';
import{filmPackagePolicyVersion,legacyFilmPackagePolicyVersion,bookFilmPackagePolicyVersion,captionStyleId,captionStyleForProfile,frozenCaptions,narrationSilence}from'@/services/video/timeline/package';
import{LocalAssetBytes}from'@/services/video/assets/local-bytes';

const id=z.string().min(1).max(120);
export const TreatmentSchema=z.strictObject({schemaVersion:z.literal(1),summary:z.string().min(1),script:z.array(z.string().min(1)).min(1),factIds:z.array(id),planRef:ObjectRefSchema});
export const FactsManifestSchema=z.strictObject({schemaVersion:z.literal(1),facts:z.array(FactSchema)});
export const AssetManifestSchema=z.strictObject({schemaVersion:z.literal(1),assets:z.array(z.strictObject({id:z.string().uuid(),analysisRef:ObjectRefSchema,rightsRef:ObjectRefSchema,originalRef:ObjectRefSchema,usage:z.string().min(1)}))});
export const SourceManifestSchema=z.strictObject({schemaVersion:z.literal(1),modules:z.array(z.strictObject({id,sourceRef:ObjectRefSchema})).min(1),actors:z.array(z.strictObject({id,sourceModuleId:id})),captionStyles:z.array(z.strictObject({id,styleRef:ObjectRefSchema}))});
export const AudioManifestSchema=z.strictObject({schemaVersion:z.literal(1),sources:z.array(z.strictObject({id,kind:z.enum(['generated','licensed','user_supplied']),sourceRef:ObjectRefSchema,rightsRef:ObjectRefSchema})),buses:z.array(z.strictObject({id})).min(1),planRef:ObjectRefSchema,timingDraftRef:ObjectRefSchema,executionRef:ObjectRefSchema.optional()});
export const SourceCodeSchema=z.strictObject({html:z.string().min(1),visualSourceRef:ObjectRefSchema,timingDraftRef:ObjectRefSchema});
const captionStyle=z.strictObject({fontSize:z.number().int(),marginV:z.number().int(),outline:z.number().int(),primary:z.string(),outlineColor:z.string()});
const logicalCaptionStyle=captionStyle.extend({playResX:z.number().int().min(64).max(3840),playResY:z.number().int().min(64).max(3840)});
const bookStyle=logicalCaptionStyle.extend({book:z.strictObject({schemaVersion:z.literal(1),rendererSha256:z.literal(bookCaptionRendererSha256),producerSha256:z.literal(bookCaptionProducerSha256),fonts:z.array(z.strictObject({id:z.string(),sha256:z.string().regex(/^[a-f0-9]{64}$/)})).length(2),safeBox:z.strictObject({x:z.number().int(),y:z.number().int(),width:z.number().int(),height:z.number().int()})})});
export const CaptionPackageSchema=z.discriminatedUnion('schemaVersion',[
 z.strictObject({schemaVersion:z.literal(1),font:LegacyTimingFontSchema,profiles:z.strictObject({full:captionStyle,preview:captionStyle,probe:captionStyle})}),
 z.strictObject({schemaVersion:z.literal(2),font:LegacyTimingFontSchema,profiles:z.strictObject({full:logicalCaptionStyle,preview:logicalCaptionStyle,probe:logicalCaptionStyle})}),
 z.strictObject({schemaVersion:z.literal(3),font:BookTimingFontSchema,profiles:z.strictObject({full:bookStyle,preview:bookStyle,probe:bookStyle})}),
]);
export function expectedCaptionPackage(font:z.infer<typeof TimingDraftSchema>['font'],output:{width:number;height:number},policyVersion:string){
 if((policyVersion===bookFilmPackagePolicyVersion)!==(font?.family==='Crayon Book Handwriting'))throw Error('FILM_CAPTION_CHANGED');
 return CaptionPackageSchema.parse({schemaVersion:policyVersion===bookFilmPackagePolicyVersion?3:policyVersion===legacyFilmPackagePolicyVersion?1:2,font,profiles:{full:captionStyleForProfile('full',output,policyVersion),preview:captionStyleForProfile('preview',output,policyVersion),probe:captionStyleForProfile('probe',output,policyVersion)}});
}
const RightsSchema=z.strictObject({basis:z.enum(['generated','licensed','user_supplied']),source:z.string().min(1)});

function unique(values:string[]){return new Set(values).size===values.length}
async function readVerifiedJson(store:AtomicStore,ref:ObjectRef,prefix:string):Promise<unknown>{
 if(ref.mime!=='application/json'||ref.bytes<1||!ref.key.startsWith(prefix))throw Error('FILM_REF_CHANGED');
 let value:unknown;try{value=(await store.readFresh<unknown>(ref.key)).value}catch{throw Error('FILM_REF_CHANGED')}
 try{if(canonicalHash(value)!==ref.sha256||Buffer.byteLength(canonicalJson(value))!==ref.bytes)throw Error('FILM_REF_CHANGED')}catch{throw Error('FILM_REF_CHANGED')}
 return value;
}
function parse<T>(schema:z.ZodType<T>,raw:unknown,errorCode='FILM_MANIFEST_INVALID'):T{const result=schema.safeParse(raw);if(!result.success)throw Error(errorCode);return result.data}

export async function loadVerifiedFilmPackage(store:AtomicStore,untrusted:unknown,audioRoot=process.env.VIDEO_DATA_DIR){
 const parsed=FilmSpecSchema.safeParse(untrusted);if(!parsed.success)throw Error('FILM_SPEC_INVALID');
 if(![filmPackagePolicyVersion,legacyFilmPackagePolicyVersion,bookFilmPackagePolicyVersion].includes(parsed.data.qualityPolicyVersion))throw Error('FILM_POLICY_UNSUPPORTED');
 const spec=parsed.data,projectPrefix=`projects/${spec.projectId}/`,revisionPrefix=`${projectPrefix}revisions/${spec.revisionId}/`;
 const top=[spec.understandingRef,spec.treatmentRef,spec.factsRef,spec.timelineRef,spec.assetManifestRef,spec.sourceManifestRef,spec.audioManifestRef];
 if(!unique(top.map(ref=>ref.key)))throw Error('FILM_SPEC_INVALID');
 const[rawUnderstanding,rawTreatment,rawFacts,rawTimeline,rawAssets,rawSources,rawAudio]=await Promise.all([
  readVerifiedJson(store,spec.understandingRef,`${projectPrefix}understanding/`),
  ...[spec.treatmentRef,spec.factsRef,spec.timelineRef,spec.assetManifestRef,spec.sourceManifestRef,spec.audioManifestRef].map(ref=>readVerifiedJson(store,ref,revisionPrefix)),
 ]);
 const understanding=parse(UnderstandingSchema,rawUnderstanding),treatment=parse(TreatmentSchema,rawTreatment),facts=parse(FactsManifestSchema,rawFacts),timeline=parse(FilmTimelineSchema,rawTimeline),assets=parse(AssetManifestSchema,rawAssets,'FILM_ASSET_INVALID'),sources=parse(SourceManifestSchema,rawSources),audio=parse(AudioManifestSchema,rawAudio,'FILM_AUDIO_PLAN_CHANGED');
 if(understanding.briefVersion!==spec.briefVersion||understanding.preferences.durationSec!==spec.output.totalFrames/spec.output.fps||understanding.preferences.aspect!==(spec.output.width>spec.output.height?'16:9':'9:16')||understanding.preferences.styleSlug!==spec.style.slug)throw Error('FILM_BRIEF_CHANGED');
 const understoodFacts=new Map(understanding.facts.map(fact=>[fact.id,fact]));
 if(!unique(understanding.facts.map(f=>f.id))||!unique(facts.facts.map(f=>f.id))||!unique(treatment.factIds)||!unique(sources.modules.map(x=>x.id))||!unique(sources.actors.map(x=>x.id))||!unique(sources.captionStyles.map(x=>x.id))||!unique(assets.assets.map(x=>x.id))||!unique(audio.sources.map(x=>x.id))||!unique(audio.buses.map(x=>x.id)))throw Error('FILM_MANIFEST_INVALID');
 const assetIds=new Set(assets.assets.map(asset=>asset.id)),messages=new Set(understanding.sourceMessageIds),factIds=new Set(facts.facts.map(fact=>fact.id));
 for(const fact of facts.facts){
  const understood=understoodFacts.get(fact.id);
  if(!understood||!['provided','confirmed'].includes(fact.status)||canonicalHash(understood)!==canonicalHash(fact)||fact.sourceRefs.some(ref=>ref.type==='user_message'&&!messages.has(ref.id)||ref.type==='uploaded_material'&&!assetIds.has(ref.id))||fact.critical&&fact.sourceRefs.every(ref=>ref.type==='inferred_preference'))throw Error('FILM_FACT_INVALID');
 }
 if(treatment.factIds.some(id=>!factIds.has(id))||facts.facts.some(fact=>fact.mustInclude&&!treatment.factIds.includes(fact.id)))throw Error('FILM_FACT_INVALID');
 const treatmentPlan=guardTreatment(await readVerifiedJson(store,treatment.planRef,revisionPrefix),understanding,getStyle(spec.style.slug).rulesHash);
 const plannedFacts=[...new Set(treatmentPlan.shots.flatMap(shot=>shot.factIds))].sort();
 if(treatment.summary!==treatmentPlan.summary||canonicalHash(treatment.script)!==canonicalHash(treatmentPlan.script)||canonicalHash([...treatment.factIds].sort())!==canonicalHash(plannedFacts)||treatmentPlan.shots.length!==timeline.shots.length||treatmentPlan.shots.some((shot,index)=>{
  const rendered=timeline.shots[index];return shot.id!==rendered.id||shot.startFrame!==rendered.startFrame||shot.endFrame!==rendered.endFrame||canonicalHash([...shot.factIds].sort())!==canonicalHash([...rendered.factIds].sort());
 }))throw Error('TREATMENT_TIMELINE_INVALID');
 const sourceIds=new Set(sources.modules.map(module=>module.id));
 const timing=parse(TimingDraftSchema,await readVerifiedJson(store,audio.timingDraftRef,`${revisionPrefix}timing-draft/`));
 if(spec.seed!==revisionSeed(spec.projectId,spec.revisionId)||timing.track.runtimeDigest!==spec.runtimeDigest||timing.font&&timing.font.runtimeDigest!==spec.runtimeDigest)throw Error('FILM_RUNTIME_CHANGED');
 if(timing.font?.family==='Crayon Book Handwriting'){if(spec.style.slug!=='crayon-book'||spec.qualityPolicyVersion!==bookFilmPackagePolicyVersion)throw Error('FILM_CAPTION_CHANGED');await frozenBookFontHashes(store,timing.font)}
 const plan=guardAudioPlan(await readVerifiedJson(store,audio.planRef,`${revisionPrefix}audio-plan/`),understanding,treatmentPlan,timing,audio.timingDraftRef.sha256,spec.seed);
  if((plan.music.length||plan.foley.length||plan.mix.voiceGainDb!==0)&&!audio.executionRef)throw Error('FILM_AUDIO_EXECUTION_NOT_READY');
 const executed=audio.executionRef?await loadAudioExecution(store,audioRoot||'',spec.projectId,spec.revisionId,audio.executionRef,audio.planRef,audio.timingDraftRef):null;
  if(canonicalHash(timeline.sections)!==canonicalHash(plan.sections)||canonicalHash(timeline.cues)!==canonicalHash(compileAudioCues(plan,timing.fps))||canonicalHash(timeline.music)!==canonicalHash(plan.music)||canonicalHash(timeline.foley)!==canonicalHash(plan.foley))throw Error('FILM_AUDIO_PLAN_CHANGED');
  if(canonicalHash(timeline.captions)!==canonicalHash(frozenCaptions(timing,treatmentPlan))||timeline.intentionalBlackRanges.length)throw Error('FILM_CAPTION_CHANGED');
 const visualByModule=new Map<string,ReturnType<typeof CompleteVisualShotSchema.parse>>();
 for(const entry of sources.modules){
  const code=parse(SourceCodeSchema,await readVerifiedJson(store,entry.sourceRef,revisionPrefix),'FILM_VISUAL_SOURCE_CHANGED');
   if(canonicalHash(code.timingDraftRef)!==canonicalHash(audio.timingDraftRef))throw Error('FILM_VISUAL_SOURCE_CHANGED');
   const visual=parse(CompleteVisualShotSchema,await readVerifiedJson(store,code.visualSourceRef,`${revisionPrefix}visual-source/`));
   guardVisualShot(visual,understanding,treatmentPlan,timing,audio.timingDraftRef.sha256,spec.seed);
   const shot=timeline.shots.find(shot=>shot.sourceModule===entry.id),direction=visual.direction;
   if(!shot||timeline.shots.filter(shot=>shot.sourceModule===entry.id).length!==1||code.html!==visual.sourceHtml||shot.id!==visual.shotId||shot.purpose!==direction.purpose||shot.framing!==direction.framing||shot.camera!==direction.camera||canonicalHash(shot.actorIds)!==canonicalHash(direction.actorIds))throw Error('FILM_VISUAL_SOURCE_CHANGED');
   visualByModule.set(entry.id,visual);
 }
 if(visualByModule.size!==timeline.shots.length||sources.modules.length!==timeline.shots.length)throw Error('FILM_VISUAL_SOURCE_CHANGED');
 for(const actor of sources.actors)if(!sourceIds.has(actor.sourceModuleId))throw Error('FILM_MANIFEST_INVALID');
 {
  const expected=new Map<string,string>();
  for(const entry of sources.modules)for(const id of visualByModule.get(entry.id)!.direction.actorIds)if(!expected.has(id))expected.set(id,entry.id);
  if(canonicalHash(sources.actors)!==canonicalHash([...expected].map(([id,sourceModuleId])=>({id,sourceModuleId}))))throw Error('FILM_VISUAL_SOURCE_CHANGED');
 }
 for(const style of sources.captionStyles){
  const raw=await readVerifiedJson(store,style.styleRef,revisionPrefix);
  {
   const expected=expectedCaptionPackage(timing.font,spec.output,spec.qualityPolicyVersion);
   if(style.id!==captionStyleId||canonicalHash(parse(CaptionPackageSchema,raw))!==canonicalHash(expected))throw Error('FILM_CAPTION_CHANGED');
  }
 }
 if(sources.captionStyles.length!==(timeline.captions.length?1:0))throw Error('FILM_CAPTION_CHANGED');
 const uses=new Map(understanding.assetUses.map(use=>[use.assetId,use]));
 if(assets.assets.length!==uses.size||understanding.assetUses.length!==uses.size)throw Error('FILM_ASSET_INVALID');
 for(const visual of visualByModule.values())if(visual.assetIds.some(id=>!assetIds.has(id)))throw Error('FILM_ASSET_INVALID');
 for(const asset of assets.assets){
  if(uses.get(asset.id)?.purpose!==asset.usage||!asset.analysisRef.key.startsWith(`${projectPrefix}assets/${asset.id}/analysis/`))throw Error('FILM_ASSET_INVALID');
  const analysis=await readVerifiedJson(store,asset.analysisRef,projectPrefix),proof=z.object({assetId:z.string().uuid(),sha256:z.string().regex(/^[a-f0-9]{64}$/),trust:z.literal('untrusted_material')}).safeParse(analysis);
  const rights=parse(RightsSchema,await readVerifiedJson(store,asset.rightsRef,revisionPrefix));
  if(!proof.success||proof.data.assetId!==asset.id||rights.basis!=='user_supplied')throw Error('FILM_ASSET_INVALID');
   const ref=asset.originalRef;
   const metadata=z.object({mime:z.string()}).safeParse(analysis);
   if(ref.key!==`assets/${spec.projectId}/${asset.id}.bin`||ref.sha256!==proof.data.sha256||!audioRoot||!metadata.success||metadata.data.mime!==ref.mime)throw Error('FILM_ASSET_INVALID');
   const actual=await new LocalAssetBytes(audioRoot).inspect(spec.projectId,asset.id,ref.mime);
   if(actual.sha256!==ref.sha256||actual.bytes!==ref.bytes)throw Error('FILM_ASSET_INVALID');
 }
 const narrationSources=new Map<string,Awaited<ReturnType<typeof loadPackagedNarration>>>(),soundSources=new Set<string>();
 for(const source of audio.sources){
  const raw=await readVerifiedJson(store,source.sourceRef,revisionPrefix),rights=parse(RightsSchema,await readVerifiedJson(store,source.rightsRef,revisionPrefix));
  if(rights.basis!==source.kind)throw Error('FILM_MANIFEST_INVALID');
  if(z.object({kind:z.literal('generated_narration')}).safeParse(raw).success){
   if(source.kind!=='generated')throw Error('FILM_NARRATION_CHANGED');
   const packaged=await loadPackagedNarration(store,audioRoot||'',spec.projectId,spec.revisionId,source.sourceRef);
   if(source.id!=='voice-'+packaged.source.lineId||narrationSources.has(packaged.source.lineId))throw Error('FILM_NARRATION_CHANGED');
   narrationSources.set(packaged.source.lineId,packaged);
  }else{
   const planned=plan.sources.find(entry=>entry.id===source.id);
   if(!executed||!planned||source.kind!=='generated'||!source.sourceRef.key.startsWith(revisionPrefix+'audio-source/')||!source.rightsRef.key.startsWith(revisionPrefix+'sound-rights/'))throw Error('FILM_AUDIO_PLAN_CHANGED');
   const expected=synthSourceDocuments(planned,audio.planRef,spec.runtimeDigest);
   if(canonicalHash(raw)!==canonicalHash(expected.document)||canonicalHash(rights)!==canonicalHash(expected.rights)||soundSources.has(source.id))throw Error('FILM_AUDIO_PLAN_CHANGED');
   soundSources.add(source.id);
  }
 }
 const expectedVoice=compileVoicePlan(treatmentPlan,understanding);
 if(soundSources.size!==plan.sources.length||audio.sources.length!==narrationSources.size+soundSources.size||canonicalHash(audio.buses)!==canonicalHash([{id:'voice'},{id:'music'},{id:'foley'}]))throw Error('FILM_AUDIO_PLAN_CHANGED');
 if(timeline.narration.length!==expectedVoice.lines.length||narrationSources.size!==timeline.narration.length)throw Error('FILM_NARRATION_CHANGED');
 for(const [index,line] of timeline.narration.entries()){
  const expected=expectedVoice.lines[index],source=narrationSources.get(line.lineId);
  if(!source||canonicalHash(source.timelineLine)!==canonicalHash(line)||line.lineId!==expected.lineId||line.displayText!==expected.displayText||line.spokenText!==expected.spokenText||line.expectedAsrText!==expected.expectedAsrText||line.startSample!==expected.startMs*48||line.endSample>48*(expected.startMs+expected.reservedMs)||source.source.voiceConfig.language!==expected.language)throw Error('FILM_NARRATION_CHANGED');
   if(source.words.speechReview&&source.words.speechReview.planSha256!==canonicalHash(expectedVoice))throw Error('FILM_NARRATION_CHANGED');
   const frozen=timing.narration[index];
   if(!frozen||frozen.lineId!==line.lineId||frozen.startSample!==line.startSample||frozen.endSample!==line.endSample||frozen.spokenText!==line.spokenText||frozen.displayText!==line.displayText||frozen.expectedAsrText!==line.expectedAsrText||frozen.voiceSha256!==line.audioRef.sha256||frozen.voiceRuntimeDigest!==source.source.voiceConfig.runtimeDigest||frozen.asrRuntimeDigest!==source.words.asrRuntimeDigest)throw Error('FILM_NARRATION_CHANGED');
 }
 if(timing.narration.length!==timeline.narration.length)throw Error('FILM_NARRATION_CHANGED');
 if(canonicalHash(timeline.intentionalSilenceRanges)!==canonicalHash([...plan.intentionalSilenceRanges,...narrationSilence(timeline.narration,timing.durationMs*48)]))throw Error('FILM_AUDIO_PLAN_CHANGED');
 const refs:TimelineReferences={sourceModules:sourceIds,actorIds:new Set(sources.actors.map(actor=>actor.id)),factIds,captionStyles:new Set(sources.captionStyles.map(style=>style.id)),audioSources:new Set(audio.sources.map(source=>source.id)),audioBuses:new Set(audio.buses.map(bus=>bus.id))};
 validateFilmTimeline(timeline,refs);validateFilmSpec(spec,timeline);
 return{filmSpec:spec,timing,understanding,treatment,treatmentPlan,facts,timeline,assetManifest:assets,sourceManifest:sources,audioManifest:audio,...(executed?{audioExecution:executed.package,filmAudioTrack:executed.track}:{})};
}
