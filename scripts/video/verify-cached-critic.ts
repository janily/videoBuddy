import {readFile,writeFile} from 'node:fs/promises';
import {FileStore} from '../../src/services/video/storage/file-store';
import {readNarrationJson} from '../../src/services/video/audio/narration-package';
import {visualReviewContext,guardVisualReview,type VisualReviewContext} from '../../src/contracts/video/visual-review';
import {readVisualEvidence} from '../../src/services/video/quality/visual-evidence';
import {canonicalHash} from '../../src/services/video/domain/hash';
async function main(){
 const critic=JSON.parse(await readFile('docs/engineering/evidence/visual-critic-probe.json','utf8')),frames=JSON.parse(await readFile('docs/engineering/evidence/visual-evidence-probe.json','utf8'));
 const store=new FileStore(critic.root),saved=await readNarrationJson(store,critic.contextRef,'projects/') as VisualReviewContext;
 const context=visualReviewContext({filmSha256:saved.filmSha256,filmSpecSha256:saved.filmSpecSha256,styleSlug:saved.styleSlug,styleRulesHash:saved.styleRulesHash,round:saved.round,frames:saved.frames,facts:saved.facts});
 if(saved.frameSetSha256!==context.frameSetSha256)throw Error('CACHED_CRITIC_EVIDENCE_CHANGED');
 const review=guardVisualReview(await readNarrationJson(store,critic.reviewRef,'projects/'),context);
 const images=await readVisualEvidence(frames.root,frames.evidence);
 if(frames.evidence.filmSha256!==context.filmSha256||canonicalHash(frames.evidence.frames.map(({id,frame,sha256,bytes}:{id:string;frame:number;sha256:string;bytes:number})=>({id,frame,sha256,bytes})))!==context.frameSetSha256||images.size!==context.frames.length)throw Error('CACHED_CRITIC_EVIDENCE_CHANGED');
 const evidence={executedAt:new Date().toISOString(),status:'binding_validated',originalReviewSha256:critic.reviewRef.sha256,frameEvidenceV2Sha256:canonicalHash(frames.evidence),frameSetSha256:context.frameSetSha256,additionalModelCalls:0,style:review.style.result,readability:review.readability.result,qualityPassed:false,limits:'Historical paid review checked against byte-identical v2 extraction receipts; original report is preserved and still fails sampled visual checks. No new semantic or listening review.'};
 await writeFile('docs/engineering/evidence/cached-critic-validation.json',JSON.stringify(evidence,null,2)+'\n');console.log(JSON.stringify(evidence));
}
main().catch(error=>{console.error(JSON.stringify({status:'fail',errorCode:error.message}));process.exitCode=1});
