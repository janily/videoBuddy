import type {ProjectStore} from '../storage/project-store';
import type {Environment} from '../config/environment';
import {canonicalHash} from '../domain/hash';
import {createOrRead} from '../storage/atomic-store';
import {assertBookCaptionGlyphs,bookFontVersion,isBookTimingFont,readBookTimingFont} from '../audio/book-font';
import {validateCaptions} from '../timeline/compile';
import {assertApprovedRenderFence,loadApprovedRenderInputs} from './approved-inputs';
import type {MvpCoreEvidence} from '../quality/approved-delivery';
/** Checks the actual locked fonts and already verified rights/manifests. This
 * covers the generated caption layer, not arbitrary text inside model HTML. */
export async function prepareMvpCoreEvidence(projects:ProjectStore,owner:string,projectId:string,operationId:string,fence:number,filmSha256:string,options:{root:string;env?:Environment;mustExist?:boolean}):Promise<MvpCoreEvidence>{
 if(!/^[a-f0-9]{64}$/.test(filmSha256))throw Error('RENDER_OUTPUT_CHANGED');
 const inputs=await loadApprovedRenderInputs(projects,owner,projectId,operationId,fence,options),{frozen}=inputs,ref=`projects/${projectId}/approvals/${inputs.approval.approvalId}/mvp-core-v1-stage`;
 if(options.mustExist)await projects.store.readFresh(ref);
 const captions=frozen.timeline.captions,font=frozen.timing.font;
 if(captions.length){
  if(!isBookTimingFont(font))throw Error('MVP_FONT_UNSUPPORTED');
  const actual=await readBookTimingFont(options.env||process.env,{version:bookFontVersion(font),mustExist:options.mustExist,journal:{store:projects.store,prefix:`projects/${projectId}/operations/${operationId}/media-effects`},assertActive:()=>assertApprovedRenderFence(projects,inputs)});
  if(canonicalHash(actual.font)!==canonicalHash(font))throw Error('FONT_RECEIPT_CHANGED');
  assertBookCaptionGlyphs(captions.map(c=>c.text),actual.glyphsById,bookFontVersion(font));
  validateCaptions(captions.map(c=>({text:c.text,startFrame:c.stableReadableStartFrame,endFrame:c.endFrame})),frozen.timeline.fps,new Set([...actual.glyphsById.values()].flatMap(glyphs=>[...glyphs])));
 }
 const record={schemaVersion:1,inputHash:inputs.inputHash,filmSha256,filmSpecSha256:inputs.bundle.filmSpecRef.sha256,fontSha256:canonicalHash(font),captionScope:'frozen_caption_layer',captionCount:captions.length,captionSha256:canonicalHash(captions),rightsScope:'verified_manifest_basis_and_locked_font_notice',assetRightsRefs:frozen.assetManifest.assets.map(a=>a.rightsRef),audioRightsRefs:frozen.audioManifest.sources.map(a=>a.rightsRef),fontCoverage:'pass' as const,subtitleSync:'pass' as const,license:'pass' as const};
 const latest=await loadApprovedRenderInputs(projects,owner,projectId,operationId,fence,options);if(latest.inputHash!==inputs.inputHash)throw Error('RENDER_FENCED');
 const saved=await createOrRead(projects.store,ref,record);if(canonicalHash(saved)!==canonicalHash(record))throw Error('RENDER_OUTPUT_CHANGED');
 await assertApprovedRenderFence(projects,inputs);return{filmSha256,fontCoverage:record.fontCoverage,subtitleSync:record.subtitleSync,license:record.license,ref};
}
