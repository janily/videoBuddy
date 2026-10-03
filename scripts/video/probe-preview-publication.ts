import {mkdtemp,cp,readFile,writeFile,realpath} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {FileStore} from '../../src/services/video/storage/file-store';
import {ProjectStore} from '../../src/services/video/storage/project-store';
import {publishPreparedPreview} from '../../src/services/video/preview/publish';
import {readPreviewBundle} from '../../src/services/video/preview/commit';
import {resolveArtifact} from '../../src/services/video/exports/access';
import type {ProjectControl} from '../../src/contracts/video/project';
import {probeEnvironment} from './helpers/real-probe';
import {runPreviewOperation} from '../../src/services/video/commands/local-preview';
import {LocalEventLog} from '../../src/services/video/stream/local-event-log';
async function main(){
 if(!process.argv.includes('--publish'))throw Error('PREVIEW_PUBLICATION_OPT_IN_REQUIRED');
 const native=JSON.parse(await readFile('docs/engineering/evidence/native-package-probe.json','utf8'));
 const root=await realpath(native.root),stateRoot=await mkdtemp(join(resolve('.video-local'),'preview-publication-'));
 // Isolate control/operation pointers. Existing immutable media remains read-only.
 await cp(join(root,'projects'),join(stateRoot,'projects'),{recursive:true});
 const projects=new ProjectStore(new FileStore(stateRoot)),prefix='projects/'+native.projectId;
 const before=(await projects.store.readFresh<ProjectControl>(prefix+'/control')).value;
 const originalBefore=await readFile(join(root,prefix,'control.json'),'utf8');
 const excerpt=JSON.parse(await readFile('docs/engineering/evidence/stereo-selected-excerpt-probe.json','utf8')).record;
 await resolveArtifact(projects,before.ownerKeyHash,native.projectId,excerpt.artifactId).then(()=>{throw Error('UNPUBLISHED_ARTIFACT_EXPOSED')},error=>{if(error.message!=='ACCESS_NOT_FOUND')throw error});
 const saved=globalThis.fetch;globalThis.fetch=async()=>{throw Error('PREVIEW_PUBLICATION_NETWORK_FORBIDDEN')};
 try{
  const input={projectId:native.projectId,revisionId:native.revisionId,operationId:before.activeProduction!,previewId:crypto.randomUUID(),expectedConsentEpoch:before.consentEpoch};
  const options={root,env:probeEnvironment(root)};
  await projects.store.create(prefix+'/operations/'+input.operationId,{id:input.operationId,projectId:input.projectId,commandId:crypto.randomUUID(),kind:'preview',status:'running',canonicalRunId:input.operationId,streamEpoch:0,fence:0,revisionId:input.revisionId,previewId:input.previewId,briefVersion:before.briefVersion,consentEpoch:before.consentEpoch,understandingRef:before.understandingRef});
  let mismatchedIntentRejected=false;
  try{await publishPreparedPreview(projects,{...input,previewId:crypto.randomUUID()},options)}catch(error){if((error as Error).message!=='PREVIEW_OPERATION_CHANGED')throw error;mismatchedIntentRejected=true}
  if(!mismatchedIntentRejected)throw Error('PREVIEW_OPERATION_MISMATCH_ACCEPTED');
  const bundle=await publishPreparedPreview(projects,input,options),published=(await projects.store.readFresh<ProjectControl>(prefix+'/control')).value;
  const replay=await publishPreparedPreview(projects,input,options);
  const verified=await readPreviewBundle(projects,input.projectId,input.previewId,root),artifact=await resolveArtifact(projects,before.ownerKeyHash,input.projectId,bundle.previewArtifactId);
  const events=new LocalEventLog(stateRoot);
  const recovery={...options,build:async()=>{throw Error('COLD_WORKER_REEXECUTED')}};
  await runPreviewOperation(projects.store,events,input.projectId,input.operationId,recovery);
  await runPreviewOperation(new FileStore(stateRoot),events,input.projectId,input.operationId,recovery);
  const stream=await events.readFrom(input.projectId,input.operationId,0);
  if(stream.length!==2||stream[0].event.type!=='preview.ready'||stream[1].event.type!=='operation.terminal'||stream[1].event.payload.status!=='succeeded')throw Error('COLD_WORKER_RECOVERY_FAILED');
  if(JSON.stringify(bundle)!==JSON.stringify(replay)||JSON.stringify(bundle)!==JSON.stringify(verified)||published.phase!=='preview_ready'||published.activeProduction!==null||published.currentPreviewId!==input.previewId||artifact.objectRef.sha256!==excerpt.previewArtifactSha256||originalBefore!==await readFile(join(root,prefix,'control.json'),'utf8'))throw Error('PREVIEW_PUBLICATION_CHANGED');
  const evidence={executedAt:new Date().toISOString(),status:'pass',stateRoot,mediaRoot:root,input,bundle,artifact,beforePublishAccessRejected:true,mismatchedIntentRejected,replayIdentical:true,coldWorkerRecovered:true,durableEvents:stream.map(({event})=>({type:event.type,payload:event.payload})),originalControlUnchanged:true,additionalModelCalls:0,limits:'Actual native 11-second stereo artifact published to an isolated durable control store and recovered by a cold preview Worker without producer re-execution. Model/style/readability failures remain unresolved; technical evidence is explicitly ineligible for delivery. This is a storage/media integration test, not end-to-end user creation or final delivery acceptance.'};
  await writeFile('docs/engineering/evidence/preview-publication-probe.json',JSON.stringify(evidence,null,2)+'\n');
  console.log(JSON.stringify({status:'pass',stateRoot,previewId:bundle.previewId,artifactSha256:bundle.previewArtifactSha256,replayIdentical:true,additionalModelCalls:0}));
 }finally{globalThis.fetch=saved}
}
main().catch(error=>{console.error(JSON.stringify({status:'fail',errorCode:error.message}));process.exitCode=1});
