import{z}from'zod';
import{FactSchema,ObjectRefSchema,UnderstandingSchema,type ObjectRef}from'./domain';
import{FilmSpecSchema,FilmTimelineSchema,validateFilmSpec,validateFilmTimeline,type TimelineReferences}from'./film';
import{canonicalHash,canonicalJson}from'@/services/video/domain/hash';
import type{AtomicStore}from'@/services/video/storage/atomic-store';

const id=z.string().min(1).max(120);
export const TreatmentSchema=z.strictObject({schemaVersion:z.literal(1),summary:z.string().min(1),script:z.array(z.string().min(1)).min(1),factIds:z.array(id)});
export const FactsManifestSchema=z.strictObject({schemaVersion:z.literal(1),facts:z.array(FactSchema)});
export const AssetManifestSchema=z.strictObject({schemaVersion:z.literal(1),assets:z.array(z.strictObject({id:z.string().uuid(),analysisRef:ObjectRefSchema,rightsRef:ObjectRefSchema,usage:z.string().min(1)}))});
export const SourceManifestSchema=z.strictObject({schemaVersion:z.literal(1),modules:z.array(z.strictObject({id,sourceRef:ObjectRefSchema})).min(1),actors:z.array(z.strictObject({id,sourceModuleId:id})),captionStyles:z.array(z.strictObject({id,styleRef:ObjectRefSchema}))});
export const AudioManifestSchema=z.strictObject({schemaVersion:z.literal(1),sources:z.array(z.strictObject({id,kind:z.enum(['generated','licensed','user_supplied']),sourceRef:ObjectRefSchema,rightsRef:ObjectRefSchema})),buses:z.array(z.strictObject({id})).min(1)});
const SourceCodeSchema=z.strictObject({html:z.string().min(1)});
const RightsSchema=z.strictObject({basis:z.enum(['generated','licensed','user_supplied']),source:z.string().min(1)});

function unique(values:string[]){return new Set(values).size===values.length}
async function readVerifiedJson(store:AtomicStore,ref:ObjectRef,prefix:string):Promise<unknown>{
 if(ref.mime!=='application/json'||ref.bytes<1||!ref.key.startsWith(prefix))throw Error('FILM_REF_CHANGED');
 let value:unknown;try{value=(await store.readFresh<unknown>(ref.key)).value}catch{throw Error('FILM_REF_CHANGED')}
 try{if(canonicalHash(value)!==ref.sha256||Buffer.byteLength(canonicalJson(value))!==ref.bytes)throw Error('FILM_REF_CHANGED')}catch{throw Error('FILM_REF_CHANGED')}
 return value;
}
function parse<T>(schema:z.ZodType<T>,raw:unknown):T{const result=schema.safeParse(raw);if(!result.success)throw Error('FILM_MANIFEST_INVALID');return result.data}

export async function loadVerifiedFilmPackage(store:AtomicStore,untrusted:unknown){
 const parsed=FilmSpecSchema.safeParse(untrusted);if(!parsed.success)throw Error('FILM_SPEC_INVALID');
 const spec=parsed.data,projectPrefix=`projects/${spec.projectId}/`,revisionPrefix=`${projectPrefix}revisions/${spec.revisionId}/`;
 const top=[spec.understandingRef,spec.treatmentRef,spec.factsRef,spec.timelineRef,spec.assetManifestRef,spec.sourceManifestRef,spec.audioManifestRef];
 if(!unique(top.map(ref=>ref.key)))throw Error('FILM_SPEC_INVALID');
 const[rawUnderstanding,rawTreatment,rawFacts,rawTimeline,rawAssets,rawSources,rawAudio]=await Promise.all([
  readVerifiedJson(store,spec.understandingRef,`${projectPrefix}understanding/`),
  ...[spec.treatmentRef,spec.factsRef,spec.timelineRef,spec.assetManifestRef,spec.sourceManifestRef,spec.audioManifestRef].map(ref=>readVerifiedJson(store,ref,revisionPrefix)),
 ]);
 const understanding=parse(UnderstandingSchema,rawUnderstanding),treatment=parse(TreatmentSchema,rawTreatment),facts=parse(FactsManifestSchema,rawFacts),timeline=parse(FilmTimelineSchema,rawTimeline),assets=parse(AssetManifestSchema,rawAssets),sources=parse(SourceManifestSchema,rawSources),audio=parse(AudioManifestSchema,rawAudio);
 if(understanding.briefVersion!==spec.briefVersion||understanding.preferences.durationSec!==spec.output.totalFrames/spec.output.fps||understanding.preferences.aspect!==(spec.output.width>spec.output.height?'16:9':'9:16')||understanding.preferences.styleSlug!==spec.style.slug)throw Error('FILM_BRIEF_CHANGED');
 const understoodFacts=new Map(understanding.facts.map(fact=>[fact.id,fact]));
 if(!unique(understanding.facts.map(f=>f.id))||!unique(facts.facts.map(f=>f.id))||!unique(treatment.factIds)||!unique(sources.modules.map(x=>x.id))||!unique(sources.actors.map(x=>x.id))||!unique(sources.captionStyles.map(x=>x.id))||!unique(assets.assets.map(x=>x.id))||!unique(audio.sources.map(x=>x.id))||!unique(audio.buses.map(x=>x.id)))throw Error('FILM_MANIFEST_INVALID');
 const assetIds=new Set(assets.assets.map(asset=>asset.id)),messages=new Set(understanding.sourceMessageIds),factIds=new Set(facts.facts.map(fact=>fact.id));
 for(const fact of facts.facts){
  const understood=understoodFacts.get(fact.id);
  if(!understood||!['provided','confirmed'].includes(fact.status)||canonicalHash(understood)!==canonicalHash(fact)||fact.sourceRefs.some(ref=>ref.type==='user_message'&&!messages.has(ref.id)||ref.type==='uploaded_material'&&!assetIds.has(ref.id))||fact.critical&&fact.sourceRefs.every(ref=>ref.type==='inferred_preference'))throw Error('FILM_FACT_INVALID');
 }
 if(treatment.factIds.some(id=>!factIds.has(id))||facts.facts.some(fact=>fact.mustInclude&&!treatment.factIds.includes(fact.id)))throw Error('FILM_FACT_INVALID');
 const sourceIds=new Set(sources.modules.map(module=>module.id));
 for(const entry of sources.modules){const code=await readVerifiedJson(store,entry.sourceRef,revisionPrefix);parse(SourceCodeSchema,code)}
 for(const actor of sources.actors)if(!sourceIds.has(actor.sourceModuleId))throw Error('FILM_MANIFEST_INVALID');
 for(const style of sources.captionStyles)await readVerifiedJson(store,style.styleRef,revisionPrefix);
 const uses=new Map(understanding.assetUses.map(use=>[use.assetId,use]));
 for(const asset of assets.assets){
  if(uses.get(asset.id)?.purpose!==asset.usage||!asset.analysisRef.key.startsWith(`${projectPrefix}assets/${asset.id}/analysis/`))throw Error('FILM_ASSET_INVALID');
  const analysis=await readVerifiedJson(store,asset.analysisRef,projectPrefix),proof=z.object({assetId:z.string().uuid(),sha256:z.string().regex(/^[a-f0-9]{64}$/),trust:z.literal('untrusted_material')}).safeParse(analysis);
  const rights=parse(RightsSchema,await readVerifiedJson(store,asset.rightsRef,revisionPrefix));
  if(!proof.success||proof.data.assetId!==asset.id||rights.basis!=='user_supplied')throw Error('FILM_ASSET_INVALID');
 }
 for(const source of audio.sources){await readVerifiedJson(store,source.sourceRef,revisionPrefix);const rights=parse(RightsSchema,await readVerifiedJson(store,source.rightsRef,revisionPrefix));if(rights.basis!==source.kind)throw Error('FILM_MANIFEST_INVALID')}
 const refs:TimelineReferences={sourceModules:sourceIds,actorIds:new Set(sources.actors.map(actor=>actor.id)),factIds,captionStyles:new Set(sources.captionStyles.map(style=>style.id)),audioSources:new Set(audio.sources.map(source=>source.id)),audioBuses:new Set(audio.buses.map(bus=>bus.id))};
 validateFilmTimeline(timeline,refs);validateFilmSpec(spec,timeline);
 return{filmSpec:spec,understanding,treatment,facts,timeline,assetManifest:assets,sourceManifest:sources,audioManifest:audio};
}
