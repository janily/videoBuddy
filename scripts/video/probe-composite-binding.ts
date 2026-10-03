import {readFile,writeFile} from 'node:fs/promises';
import {FileStore} from '../../src/services/video/storage/file-store';
import {ProjectStore} from '../../src/services/video/storage/project-store';
import {readNarrationJson} from '../../src/services/video/audio/narration-package';
import {loadVerifiedFilmPackage} from '../../src/contracts/video/film-package';
import {verifyCompositeForFilm,assertCompositePackageFields} from '../../src/services/video/quality/composite-binding';
import type {ProjectControl} from '../../src/contracts/video/project';
import {probeEnvironment} from './helpers/real-probe';
async function main(){
 if(!process.argv.includes('--verify'))throw Error('COMPOSITE_BINDING_OPT_IN_REQUIRED');
 const native=JSON.parse(await readFile('docs/engineering/evidence/native-package-probe.json','utf8')),projects=new ProjectStore(new FileStore(native.root));
 const spec=await readNarrationJson(projects.store,native.film.filmSpecRef,'projects/'+native.projectId+'/revisions/'+native.revisionId+'/film/');
 const frozen=await loadVerifiedFilmPackage(projects.store,spec,native.root),control=(await projects.store.readFresh<ProjectControl>('projects/'+native.projectId+'/control')).value;
 if(!control.activeProduction)throw Error('COMPOSITE_BINDING_OPERATION_MISSING');
 const fetch=globalThis.fetch;globalThis.fetch=async()=>{throw Error('COMPOSITE_BINDING_NETWORK_FORBIDDEN')};
 try{
  const movie=await verifyCompositeForFilm(projects,native.root,frozen,control.activeProduction,control.consentEpoch,'preview',probeEnvironment(native.root));
  const rejected:string[]=[];
  for(const field of ['timingDraftSha256','audioPlanSha256','audioExecutionSha256'] as const){
   let failed=false;try{assertCompositePackageFields({...movie,[field]:'0'.repeat(64)},frozen)}catch{failed=true}
   if(!failed)throw Error('COMPOSITE_BINDING_TAMPER_ACCEPTED');rejected.push(field);
  }
  const evidence={executedAt:new Date().toISOString(),status:'pass',filmSpecSha256:native.film.filmSpecRef.sha256,filmSha256:movie.technicalQa.sha256,stageKey:movie.stageKey,rejected,additionalModelCalls:0,limits:'Read-only verification of frozen sources, timing, audio and recomputed picture/composite keys. No semantic or listening pass.'};
  await writeFile('docs/engineering/evidence/composite-binding-probe.json',JSON.stringify(evidence,null,2)+'\n');console.log(JSON.stringify(evidence));
 }finally{globalThis.fetch=fetch}
}
main().catch(error=>{console.error(JSON.stringify({status:'fail',errorCode:error.message}));process.exitCode=1});
