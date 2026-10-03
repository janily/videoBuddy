import type {loadVerifiedFilmPackage} from '@/contracts/video/film-package';
import type {ObjectRef} from '@/contracts/video/domain';
import type {Environment} from '@/services/video/config/environment';
import type {ProjectStore} from '@/services/video/storage/project-store';
import {canonicalHash} from '@/services/video/domain/hash';
import {readNarrationJson} from '@/services/video/audio/narration-package';
import {prepareCompositeStage,type CompositeStageRecord} from '@/services/video/preview/composite-stage';
import type {VisualStageRecord} from '@/services/video/preview/visual-stage';
type Frozen=Awaited<ReturnType<typeof loadVerifiedFilmPackage>>;
export function assertCompositePackageFields(movie:CompositeStageRecord,frozen:Frozen){
 if(movie.schemaVersion!==4||movie.briefVersion!==frozen.filmSpec.briefVersion||movie.treatmentSha256!==frozen.treatment.planRef.sha256||movie.timingDraftSha256!==frozen.audioManifest.timingDraftRef.sha256||movie.audioPlanSha256!==frozen.audioManifest.planRef.sha256||movie.audioExecutionSha256!==(frozen.audioManifest.executionRef?.sha256||null)||!(['pictureSequenceHash','voiceVerifiedSha256','narrationPackageSha256'] as const).every(field=>/^[a-f0-9]{64}$/.test(movie[field])))throw Error('CRITIC_COMPOSITE_BINDING_INVALID');
}
// Read-only producer verification recomputes each picture job, sequence and final
// composition key; bridges its stage references to the frozen seven manifests.
export async function verifyCompositeForFilm(projects:ProjectStore,root:string,frozen:Frozen,operationId:string,consentEpoch:number,profile:'full'|'preview',env:Environment){
 const {projectId,revisionId}=frozen.filmSpec,prefix='projects/'+projectId+'/revisions/'+revisionId+'/';
 const movie=(await projects.store.readFresh<CompositeStageRecord>(prefix+'composite-v4/'+profile)).value;assertCompositePackageFields(movie,frozen);
 async function bridge(key:string,field:string,expected:ObjectRef){
  const value=(await projects.store.readFresh<Record<string,ObjectRef>>(prefix+key)).value;
  if(canonicalHash(value[field])!==canonicalHash(expected))throw Error('CRITIC_COMPOSITE_BINDING_INVALID');
 }
 await bridge('timing-stage','draftRef',frozen.audioManifest.timingDraftRef);
 await bridge('audio-plan-stage','planRef',frozen.audioManifest.planRef);
 if(frozen.audioManifest.executionRef)await bridge('audio-execution-v2-stage','packageRef',frozen.audioManifest.executionRef);
 for(const shot of frozen.timeline.shots){
  const entry=frozen.sourceManifest.modules.find(entry=>entry.id===shot.sourceModule);if(!entry)throw Error('CRITIC_COMPOSITE_BINDING_INVALID');
  const source=await readNarrationJson(projects.store,entry.sourceRef,prefix) as {visualSourceRef:ObjectRef};
  const visual=(await projects.store.readFresh<VisualStageRecord>(prefix+'visual/'+canonicalHash({shotId:shot.id}))).value;
  if(canonicalHash(visual.sourceRef)!==canonicalHash(source.visualSourceRef))throw Error('CRITIC_COMPOSITE_BINDING_INVALID');
 }
 const checked=await prepareCompositeStage(projects,projectId,revisionId,operationId,consentEpoch,frozen.treatment.planRef,{root,env,profile,mustExist:true});
 if(canonicalHash(checked)!==canonicalHash(movie))throw Error('CRITIC_COMPOSITE_BINDING_INVALID');return checked;
}
