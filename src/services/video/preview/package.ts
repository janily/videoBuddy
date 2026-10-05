import {isBookTimingFont} from '../audio/book-font';
import {frozenBookFontHashes} from '../audio/book-font-receipt';
import{z}from'zod';
import{canonicalHash,canonicalJson}from'@/services/video/domain/hash';
import{loadVerifiedFilmPackage}from'@/contracts/video/film-package';
import{readSubtitleFontReceipt}from'@/services/video/audio/font-receipt';
import{filmDeliveryPolicy}from'@/services/video/quality/delivery';
import type{ProjectStore}from'@/services/video/storage/project-store';
import type{PreviewBundle}from'./bundle';
import{validatePreviewSegments}from'./render-excerpt';

export async function verifyPreviewPackage(projects:ProjectStore,projectId:string,bundle:PreviewBundle,storageRoot?:string){
 try{
  if(bundle.filmSpecRef.mime!=='application/json'||!bundle.filmSpecRef.key.startsWith(`projects/${projectId}/revisions/${bundle.revisionId}/film/`))throw Error('PREVIEW_PACKAGE_INVALID');
  const film=(await projects.store.readFresh<unknown>(bundle.filmSpecRef.key)).value;
  if(canonicalHash(film)!==bundle.filmSpecRef.sha256||Buffer.byteLength(canonicalJson(film))!==bundle.filmSpecRef.bytes)throw Error('PREVIEW_PACKAGE_INVALID');
  const verified=await loadVerifiedFilmPackage(projects.store,film,storageRoot),{filmSpec,treatment,facts,timeline,sourceManifest,audioManifest,assetManifest}=verified;
  if(filmSpec.projectId!==projectId||filmSpec.revisionId!==bundle.revisionId||filmSpec.briefVersion!==bundle.briefVersion||bundle.sourceDurationMs!==filmSpec.output.totalFrames*1000/filmSpec.output.fps||
   treatment.summary!==bundle.summary||canonicalHash(treatment.script)!==canonicalHash(bundle.script))throw Error('PREVIEW_PACKAGE_INVALID');
  const shown=facts.facts.map(fact=>({text:fact.text,source:fact.status==='confirmed'?'用户确认':'用户提供'}));
  const critical=facts.facts.filter(fact=>fact.critical).map(fact=>({text:fact.text,source:fact.status==='confirmed'?'用户确认':'用户提供'}));
  if(canonicalHash(shown)!==canonicalHash(bundle.facts)||canonicalHash(critical)!==canonicalHash(bundle.criticalFacts))throw Error('PREVIEW_PACKAGE_INVALID');
  const inputs=bundle.renderInputs,profile=inputs.profile;
  if(inputs.qualityPolicySha256!==canonicalHash(filmDeliveryPolicy(timeline)))throw Error('PREVIEW_PACKAGE_INVALID');
  if(profile.width!==filmSpec.output.width||profile.height!==filmSpec.output.height||profile.fps!==filmSpec.output.fps||inputs.runtimeDigests.media!==filmSpec.runtimeDigest||
   inputs.timelineSha256!==filmSpec.timelineRef.sha256||inputs.audioSha256!==filmSpec.audioManifestRef.sha256||
   inputs.sourceCodeSha256!==canonicalHash(sourceManifest.modules.map(item=>({id:item.id,sha256:item.sourceRef.sha256}))))throw Error('PREVIEW_PACKAGE_INVALID');
  const digest=z.string().regex(/^[a-f0-9]{64}$/),assetHashes=[] as string[];
  for(const asset of assetManifest.assets){const analysis=(await projects.store.readFresh<unknown>(asset.analysisRef.key)).value,found=z.object({sha256:digest}).safeParse(analysis);if(!found.success)throw Error('PREVIEW_PACKAGE_INVALID');assetHashes.push(found.data.sha256)}
  const fontHashes=sourceManifest.captionStyles.length?(isBookTimingFont(verified.timing.font)?await frozenBookFontHashes(projects.store,verified.timing.font):[await readSubtitleFontReceipt(projects.store,filmSpec.runtimeDigest)]):[];
  if(canonicalHash(assetHashes)!==canonicalHash(inputs.assetSha256s)||canonicalHash(fontHashes)!==canonicalHash(inputs.fontSha256s))throw Error('PREVIEW_PACKAGE_INVALID');
  validatePreviewSegments(bundle.excerptMap,bundle.sourceDurationMs,filmSpec.output.fps);
  const shots=new Map(timeline.shots.map(shot=>[shot.id,shot]));
  for(const segment of bundle.excerptMap){
   const shot=shots.get(segment.shotId!),start=segment.sourceStartMs!,end=segment.sourceEndMs!;
   if(!shot||start*filmSpec.output.fps<shot.startFrame*1000||end*filmSpec.output.fps>shot.endFrame*1000)throw Error('PREVIEW_PACKAGE_INVALID');
   for(const line of timeline.narration)if(line.startSample<end*48&&line.endSample>start*48&&(line.startSample<start*48||line.endSample>end*48))throw Error('PREVIEW_PACKAGE_INVALID');
  }
  if(audioManifest.buses.length===0)throw Error('PREVIEW_PACKAGE_INVALID');
  return verified;
 }catch{throw Error('PREVIEW_PACKAGE_INVALID')}
}
