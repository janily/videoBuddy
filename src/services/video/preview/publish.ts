import {isBookTimingFont} from '../audio/book-font';
import {frozenBookFontHashes} from '../audio/book-font-receipt';
import {isAbsolute} from 'node:path';
import {z} from 'zod';
import type {ProjectControl} from '@/contracts/video/project';
import {loadVerifiedFilmPackage} from '@/contracts/video/film-package';
import type {ProjectStore} from '@/services/video/storage/project-store';
import {createOrRead,StoreMissing} from '@/services/video/storage/atomic-store';
import {canonicalHash} from '@/services/video/domain/hash';
import {readNarrationJson} from '@/services/video/audio/narration-package';
import {readPinnedSubtitleFontFileHash} from '@/services/video/audio/subtitles';
import {recordSubtitleFontReceipt} from '@/services/video/audio/font-receipt';
import type {Environment} from '@/services/video/config/environment';
import {prepareVisualReviewBatch} from '@/services/video/quality/visual-review-stage';
import {verifyCompositeForFilm} from '@/services/video/quality/composite-binding';
import {verifyFrozenDeliveryPolicy} from '@/services/video/quality/delivery';
import {guardVisualReview,assertPreviewReviewEligible,type VisualReviewContext} from '@/contracts/video/visual-review';
import type {FilmPackageStageRecord} from './film-package-stage';
import type {PreviewExcerptRecord} from './excerpt-stage';
import {preparePreviewExcerptStage} from './excerpt-stage';
import {selectPreviewExcerpt} from './select-excerpt';
import {createPreviewBundle,type PreviewBundle} from './bundle';
import {commitPreviewBundle,readPreviewBundle} from './commit';
import {assertPreviewProductionFence} from './fence';
import {assertPreviewOperation} from './operation';

const inputSchema=z.strictObject({projectId:z.uuid(),revisionId:z.uuid(),operationId:z.uuid(),previewId:z.uuid(),expectedConsentEpoch:z.number().int().nonnegative()});
interface Options{root:string;env?:Environment;reviewBatches?:Array<{frames:number[];round:1|2}>}
// Publication consumes durable stages; it may verify media, but never requests a model.
export async function publishPreparedPreview(projects:ProjectStore,raw:z.input<typeof inputSchema>,options:Options):Promise<PreviewBundle>{
 const input=inputSchema.parse(raw),{projectId,revisionId,operationId,previewId,expectedConsentEpoch}=input;
 const {root}=options;if(!isAbsolute(root))throw Error('CONFIGURATION_REQUIRED: VIDEO_DATA_DIR');
 const env=options.env||process.env,prefix=`projects/${projectId}`,revisionPrefix=`${prefix}/revisions/${revisionId}/`;
 const candidateKey=`${prefix}/previews/${previewId}/candidate`;
 const control=(await projects.store.readFresh<ProjectControl>(prefix+'/control')).value;
 await assertPreviewOperation(projects,control,operationId,revisionId,previewId,expectedConsentEpoch);
 let candidate:{inputHash:string;bundle:PreviewBundle}|undefined;
 try{candidate=(await projects.store.readFresh<{inputHash:string;bundle:PreviewBundle}>(candidateKey)).value}catch(error){if(!(error instanceof StoreMissing))throw error}
 const inputHash=canonicalHash({input,reviewBatches:options.reviewBatches||[]});
 if(candidate&&candidate.inputHash!==inputHash)throw Error('PREVIEW_STAGE_CONFLICT');
 if(control.currentPreviewId===previewId&&control.phase==='preview_ready'&&candidate){
  await commitPreviewBundle(projects,projectId,operationId,expectedConsentEpoch,candidate.bundle,root);
  return readPreviewBundle(projects,projectId,previewId,root);
 }
 assertPreviewProductionFence(control,projectId,operationId,expectedConsentEpoch);
 const filmRecord=(await projects.store.readFresh<FilmPackageStageRecord>(revisionPrefix+'film-package-v2-stage')).value;
 if(filmRecord.schemaVersion!==2||filmRecord.briefVersion!==control.briefVersion)throw Error('PREVIEW_PACKAGE_INVALID');
 const frozen=await loadVerifiedFilmPackage(projects.store,await readNarrationJson(projects.store,filmRecord.filmSpecRef,revisionPrefix+'film/'),root);
 const spec=frozen.filmSpec;
 if(spec.projectId!==projectId||spec.revisionId!==revisionId||spec.briefVersion!==control.briefVersion||canonicalHash(spec.understandingRef)!==canonicalHash(control.understandingRef))throw Error('PREVIEW_PACKAGE_INVALID');
 const policy=await readNarrationJson(projects.store,filmRecord.qualityPolicyRef,revisionPrefix+'quality-policy/');
 const expectedPolicy=verifyFrozenDeliveryPolicy(frozen.timeline,policy,frozen.understanding);
 if(canonicalHash(policy)!==canonicalHash(expectedPolicy))throw Error('PREVIEW_PACKAGE_INVALID');
 await verifyCompositeForFilm(projects,root,frozen,operationId,expectedConsentEpoch,'preview',env);
 const expectedSegments=selectPreviewExcerpt(frozen.timeline,frozen.facts.facts.filter(f=>f.critical||f.mustInclude).map(f=>f.id));
 // Read first: a missing excerpt is a missing producer, never an implicit render.
 const prior=(await projects.store.readFresh<PreviewExcerptRecord>(revisionPrefix+'preview-excerpt-v2/preview')).value;
 if(canonicalHash(prior.excerptMap)!==canonicalHash(expectedSegments))throw Error('PREVIEW_STAGE_CONFLICT');
 const excerpt=await preparePreviewExcerptStage(projects,projectId,revisionId,operationId,expectedConsentEpoch,frozen.treatment.planRef,expectedSegments,{root,env,composite:{mustExist:true}});
 const reviews=[];
 for(const batch of options.reviewBatches||[]){
  const review=await prepareVisualReviewBatch(projects,projectId,revisionId,operationId,expectedConsentEpoch,filmRecord.filmSpecRef,'preview',batch.frames,batch.round,{root,env,mustExist:true});
  const context=await readNarrationJson(projects.store,review.contextRef,revisionPrefix+'visual-review-context/') as VisualReviewContext;
  assertPreviewReviewEligible(guardVisualReview(await readNarrationJson(projects.store,review.reviewRef,revisionPrefix+'visual-review/'),context));reviews.push(review);
 }
 const evidence={schemaVersion:1,filmSpecRef:filmRecord.filmSpecRef,excerptSha256:excerpt.previewArtifactSha256,excerptMap:excerpt.excerptMap,technicalQa:excerpt.technicalQa,visualReviewRefs:reviews.map(r=>r.reviewRef),qualityStatus:reviews.length?'sampled_visuals_only':'technical_only',deliveryEligible:false};
 const evidenceRef=await projects.index.immutable(revisionPrefix+'preview-quality-evidence',evidence);
 const assetSha256s=[] as string[];
 for(const asset of frozen.assetManifest.assets){const analysis=await readNarrationJson(projects.store,asset.analysisRef,prefix+'/');const value=z.object({sha256:z.string().regex(/^[a-f0-9]{64}$/)}).parse(analysis);assetSha256s.push(value.sha256)}
 const fontSha256s=frozen.sourceManifest.captionStyles.length?(isBookTimingFont(frozen.timing.font)?await frozenBookFontHashes(projects.store,frozen.timing.font):[await recordSubtitleFontReceipt(projects.store,spec.runtimeDigest,await readPinnedSubtitleFontFileHash(spec.runtimeDigest))]):[];
 const facts=frozen.facts.facts.map(f=>({text:f.text,source:f.status==='confirmed'?'用户确认':'用户提供'}));
 const bundle=createPreviewBundle({previewId,revisionId,briefVersion:spec.briefVersion,filmSpecRef:{...filmRecord.filmSpecRef,mime:'application/json'},
  renderInputs:{sourceCodeSha256:canonicalHash(frozen.sourceManifest.modules.map(m=>({id:m.id,sha256:m.sourceRef.sha256}))),timelineSha256:spec.timelineRef.sha256,audioSha256:spec.audioManifestRef.sha256,assetSha256s,fontSha256s,profile:{width:spec.output.width,height:spec.output.height,fps:spec.output.fps},runtimeDigests:{media:spec.runtimeDigest},qualityPolicySha256:filmRecord.qualityPolicyRef.sha256,...(expectedPolicy.schemaVersion===2?{qualityPolicyRef:{...filmRecord.qualityPolicyRef,mime:'application/json' as const}}:{})},
  script:frozen.treatment.script,facts,criticalFacts:frozen.facts.facts.filter(f=>f.critical).map(f=>({text:f.text,source:f.status==='confirmed'?'用户确认':'用户提供'})),summary:frozen.treatment.summary,
  previewArtifactId:excerpt.artifactId,previewArtifactSha256:excerpt.previewArtifactSha256,excerptMap:excerpt.excerptMap,sourceDurationMs:spec.output.totalFrames*1000/spec.output.fps,qualityEvidenceRefs:[evidenceRef.key,...reviews.map(r=>r.reviewRef.key)]});
 const saved=await createOrRead(projects.store,candidateKey,{inputHash,bundle});
 if(saved.inputHash!==inputHash)throw Error('PREVIEW_STAGE_CONFLICT');
 // Expiry and IDs survive a crash before/after pointer CAS.
 if(candidate&&canonicalHash(saved)!==canonicalHash(candidate))throw Error('PREVIEW_STAGE_CONFLICT');
 await commitPreviewBundle(projects,projectId,operationId,expectedConsentEpoch,saved.bundle,root);
 return saved.bundle;
}
