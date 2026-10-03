import {readFile,writeFile,cp,mkdtemp,rm,mkdir,realpath} from 'node:fs/promises';
import {join,relative,isAbsolute,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {extractVisualFrames,readVisualEvidence} from '../../src/services/video/quality/visual-evidence';
import {technicalVideoQa} from '../../src/services/video/media/technical-qa';
import {probeEnvironment} from './helpers/real-probe';
import {createHash} from 'node:crypto';
async function main(){
 if(!process.argv.includes('--frames'))throw Error('VISUAL_EVIDENCE_OPT_IN_REQUIRED');
 const native=JSON.parse(await readFile('docs/engineering/evidence/native-package-probe.json','utf8')),root=await realpath(native.root),rel=relative(await realpath(resolve('.video-local/real-creation')),root);
 if(!rel||rel.startsWith('..')||isAbsolute(rel))throw Error('VISUAL_EVIDENCE_NATIVE_ROOT_REQUIRED');
 const env=probeEnvironment(root),composite=native.composite,qa=composite.technicalQa;
 const actual=await technicalVideoQa(join(root,'composition',composite.stageKey),env.VIDEO_MEDIA_IMAGE_REF!,'output/final.mp4',{width:qa.width,height:qa.height,durationSec:qa.durationSec,fps:qa.fps,audio:true,audioChannels:2});
 if(actual.sha256!==qa.sha256)throw Error('VISUAL_EVIDENCE_FILM_CHANGED');
 const film={outputPath:composite.outputPath,sha256:actual.sha256,width:qa.width,height:qa.height,totalFrames:qa.frames},frames=[60,192,324,432];
 const evidence=await extractVisualFrames(root,film,frames,env.VIDEO_MEDIA_IMAGE_REF!);
 const replay=await extractVisualFrames(root,film,frames,env.VIDEO_MEDIA_IMAGE_REF!);if(JSON.stringify(replay)!==JSON.stringify(evidence))throw Error('VISUAL_EVIDENCE_REPLAY_CHANGED');
 const cold=await mkdtemp(join(tmpdir(),'vb-visual-cold-'));
 try{
  await mkdir(join(cold,'visual-evidence'),{recursive:true});await cp(join(root,'visual-evidence',evidence.stageKey),join(cold,'visual-evidence',evidence.stageKey),{recursive:true});
  await mkdir(join(cold,'visual-frame-runs'),{recursive:true});await cp(join(root,'visual-frame-runs',evidence.stageKey+'.json'),join(cold,'visual-frame-runs',evidence.stageKey+'.json'));
  const images=await readVisualEvidence(cold,evidence);if(images.size!==frames.length)throw Error('VISUAL_EVIDENCE_COLD_FAILED');
  // Replace frame 60 by the real decoded frame 324, and re-sign only the cache.
  // The fixed extraction receipt must still reject the changed frame binding.
  const replacement=Buffer.from(images.get('frame-324')!),forged={...evidence,frames:evidence.frames.map((frame,i)=>i?frame:{...frame,bytes:replacement.length,sha256:createHash('sha256').update(replacement).digest('hex')})};
  const firstPath=join(cold,'visual-evidence',evidence.stageKey,evidence.frames[0].filename),original=await readFile(firstPath),manifestPath=join(cold,'visual-evidence',evidence.stageKey,'manifest.json');
  await writeFile(firstPath,replacement);await writeFile(manifestPath,JSON.stringify(forged));
  let resignedCacheRejected=false;try{await readVisualEvidence(cold,forged)}catch{resignedCacheRejected=true}if(!resignedCacheRejected)throw Error('VISUAL_EVIDENCE_RESIGNED_CACHE_ACCEPTED');
  await writeFile(firstPath,original);await writeFile(manifestPath,JSON.stringify(evidence));
  const path=join(cold,'visual-evidence',evidence.stageKey,evidence.frames[0].filename),bytes=await readFile(path);bytes[bytes.length-1]^=1;await writeFile(path,bytes);
  let tamperRejected=false;try{await readVisualEvidence(cold,evidence)}catch{tamperRejected=true}if(!tamperRejected)throw Error('VISUAL_EVIDENCE_TAMPER_ACCEPTED');
  await writeFile('docs/engineering/evidence/visual-evidence-probe.json',JSON.stringify({executedAt:new Date().toISOString(),status:'pass',root,projectId:native.projectId,revisionId:native.revisionId,filmSpecRef:native.film.filmSpecRef,evidence,sourceVideoQa:actual,coldRead:'pass',tamperRejected,resignedCacheRejected,additionalModelCalls:0,limits:'Four exact decoded native-model movie frames only. Film SHA verified before and after extraction; no semantic, full-frame coverage, reading-time or listening pass claimed.'},null,2)+'\n');
  console.log(JSON.stringify({status:'pass',frames:frames.length,filmSha256:actual.sha256,stageKey:evidence.stageKey,coldRead:'pass',tamperRejected,resignedCacheRejected}));
 }finally{await rm(cold,{recursive:true,force:true})}
}
main().catch(error=>{console.error(JSON.stringify({status:'fail',errorCode:error?.message||'VISUAL_EVIDENCE_FAILED'}));process.exitCode=1});
