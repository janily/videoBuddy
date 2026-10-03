import{expect,it}from'vitest';
import{mkdtemp,rm}from'node:fs/promises';
import{tmpdir}from'node:os';
import{join}from'node:path';
import{randomUUID}from'node:crypto';
import{FileStore}from'@/services/video/storage/file-store';
import{ProjectStore}from'@/services/video/storage/project-store';
import{loadVerifiedFilmPackage}from'@/contracts/video/film-package';
import type{FilmSpec}from'@/contracts/video/film';
import{seedPreviewBundle}from'./fixtures/preview-package';

it('T01 derives timeline authority from complete immutable facts, source and audio manifests',async()=>{
 const root=await mkdtemp(join(tmpdir(),'vb-film-package-'));
 try{
  const projects=new ProjectStore(new FileStore(root)),projectId=randomUUID(),revisionId=randomUUID(),prefix=`projects/${projectId}/revisions/${revisionId}`;
  const bundle=await seedPreviewBundle(projects,{projectId,revisionId,durationSec:20,briefVersion:1,previewArtifactSha256:'a'.repeat(64)});
  const spec=(await projects.store.readFresh<FilmSpec>(bundle.filmSpecRef.key)).value,index=projects.index;
  const frozen=await loadVerifiedFilmPackage(projects.store,spec),treatmentPlan=frozen.treatmentPlan,sourceManifest=frozen.sourceManifest;
  expect(frozen.timeline.totalFrames).toBe(480);
  const alteredPlanRef=await index.immutable(`${prefix}/treatment-plan`,{...treatmentPlan,shots:[{...treatmentPlan.shots[0],factIds:[]}]});
  const alteredTreatmentRef=await index.immutable(`${prefix}/treatment`,{...frozen.treatment,planRef:alteredPlanRef});
  await expect(loadVerifiedFilmPackage(projects.store,{...spec,treatmentRef:alteredTreatmentRef})).rejects.toThrow('TREATMENT_FACT_MISSING');
  const missingModuleRef=await index.immutable(`${prefix}/sources`,{...sourceManifest,modules:[{...sourceManifest.modules[0],id:'other'}],actors:[]});
  await expect(loadVerifiedFilmPackage(projects.store,{...spec,sourceManifestRef:missingModuleRef})).rejects.toThrow('FILM_VISUAL_SOURCE_CHANGED');
  const staleUnderstandingRef=await index.immutable(`projects/${projectId}/understanding/2`,{...frozen.understanding,briefVersion:2});
  await expect(loadVerifiedFilmPackage(projects.store,{...spec,understandingRef:staleUnderstandingRef})).rejects.toThrow('FILM_BRIEF_CHANGED');
  const forgedFactsRef=await index.immutable(`${prefix}/facts`,{schemaVersion:1,facts:[{...frozen.facts.facts[0],id:'invented-fact'}]});
  await expect(loadVerifiedFilmPackage(projects.store,{...spec,factsRef:forgedFactsRef})).rejects.toThrow('FILM_FACT_INVALID');
  const unknownAssetId=randomUUID(),analysisRef=await index.immutable(`projects/${projectId}/assets/${unknownAssetId}/analysis`,{schemaVersion:5,assetId:unknownAssetId,sha256:'b'.repeat(64),trust:'untrusted_material'}),rightsRef=await index.immutable(`${prefix}/rights`,{basis:'user_supplied',source:'test'});
  const unknownAssetManifestRef=await index.immutable(`${prefix}/assets`,{schemaVersion:1,assets:[{id:unknownAssetId,analysisRef,rightsRef,usage:'illustration'}]});
  await expect(loadVerifiedFilmPackage(projects.store,{...spec,assetManifestRef:unknownAssetManifestRef})).rejects.toThrow('FILM_ASSET_INVALID');
  const strippedAudioRef=await index.immutable(`${prefix}/audio`,{schemaVersion:1,sources:[],buses:[{id:'voice'}]});
  await expect(loadVerifiedFilmPackage(projects.store,{...spec,audioManifestRef:strippedAudioRef})).rejects.toThrow('FILM_AUDIO_PLAN_CHANGED');
  await expect(loadVerifiedFilmPackage(projects.store,{...spec,audioManifestRef:strippedAudioRef,qualityPolicyVersion:'v1'})).rejects.toThrow('FILM_POLICY_UNSUPPORTED');
  const old=await projects.store.readFresh(spec.timelineRef.key);
  await projects.store.cas(spec.timelineRef.key,old.etag,{...frozen.timeline,shots:[{...frozen.timeline.shots[0],purpose:'changed'}]});
  await expect(loadVerifiedFilmPackage(projects.store,spec)).rejects.toThrow('FILM_REF_CHANGED');
 }finally{await rm(root,{recursive:true,force:true})}
});
