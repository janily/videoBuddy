import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {mkdtemp,mkdir,readFile,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {FileStore} from '../../src/services/video/storage/file-store';
import {ProjectStore} from '../../src/services/video/storage/project-store';
import {updateJson} from '../../src/services/video/storage/atomic-store';
import type {ProjectControl} from '../../src/contracts/video/project';
import {AudioExecutionSchema,loadAudioExecution} from '../../src/services/video/audio/execution-package';
import {AudioPlanSchema} from '../../src/contracts/video/audio-plan';
import {buildSoundStems,frozenAudioInput} from '../../src/services/video/audio/sound';
import {buildAudioMaster} from '../../src/services/video/audio/master';
import {inspectTrackWav} from '../../src/services/video/audio/wav';
import {canonicalHash} from '../../src/services/video/domain/hash';
import {assertPreviewProductionFence} from '../../src/services/video/preview/fence';
import {cancelProduction} from '../../src/services/video/commands/cancel';
async function docker(args:string[]){
 const child=spawn('docker',args,{stdio:['ignore','pipe','pipe'],signal:AbortSignal.timeout(15000)}),chunks:Buffer[]=[];let size=0;
 child.stdout.on('data',(chunk:Buffer)=>{size+=chunk.length;if(size<=65536)chunks.push(chunk)});child.stderr.resume();
 const code=await new Promise<number>((resolve,reject)=>{child.once('error',reject);child.once('close',value=>resolve(value??1))});if(code!==0||size>65536)throw Error('AUDIO_PROBE_DOCKER_UNKNOWN');return Buffer.concat(chunks).toString('utf8').trim();
}
async function main(){
 if(!process.argv.includes('--audio-cancellation'))throw Error('AUDIO_PRODUCTION_CANCELLATION_OPT_IN_REQUIRED');
 const proof=JSON.parse(await readFile('docs/engineering/evidence/native-package-probe.json','utf8')),source=new FileStore(proof.root),prefix=`projects/${proof.projectId}`;
 const controlBefore=(await source.readFresh(prefix+'/control')).value,budgetBefore=(await source.readFresh(prefix+'/budget')).value;
 const data=AudioExecutionSchema.parse((await source.readFresh(proof.audio.packageRef.key)).value);await loadAudioExecution(source,proof.root,proof.projectId,proof.revisionId,proof.audio.packageRef,data.planRef,data.timingDraftRef);
 const plan=AudioPlanSchema.parse((await source.readFresh(data.planRef.key)).value),env={VIDEO_MEDIA_IMAGE_REF:'sha256:'+data.runtimeDigest,VIDEO_MEDIA_RUNTIME_DIGEST:data.runtimeDigest,VIDEO_MEDIA_TIMEOUT_SECONDS:'180'},owner='a'.repeat(64);
 async function diagnostic(){
  const root=await mkdtemp(resolve('.video-local/audio-production-cancel-')),projects=new ProjectStore(new FileStore(root)),{projectId}=await projects.create(owner,{schemaVersion:5,clientCommandId:randomUUID(),clientCreateId:randomUUID()}),operationId=randomUUID();
  const control=await updateJson(projects.store,`projects/${projectId}/control`,(c:ProjectControl)=>({...c,phase:'preparing_preview' as const,activeProduction:operationId}));
  await projects.store.create(`projects/${projectId}/operations/${operationId}`,{id:operationId,projectId,kind:'preview',status:'running',fence:0,canonicalRunId:operationId,streamEpoch:0});
  async function fence(){assertPreviewProductionFence(await projects.access(owner,projectId),projectId,operationId,control.consentEpoch,{briefVersion:control.briefVersion,understandingRef:control.understandingRef})}
  return{root,projects,projectId,operationId,fence};
 }
 let networkCalls=0;const previousFetch=globalThis.fetch;globalThis.fetch=async()=>{networkCalls++;throw Error('AUDIO_PROBE_NETWORK_FORBIDDEN')};
 try{
  const baseline=await diagnostic();let baselineChecks=0;const baselineFence=async()=>{baselineChecks++;await baseline.fence()};
  const stems=await buildSoundStems(baseline.root,plan,data.durationMs,data.fps,env,{assertActive:baselineFence});
  if(stems.music.wav.sha256!==data.tracks.music.wav.sha256||stems.foley.wav.sha256!==data.tracks.foley.wav.sha256)throw Error('AUDIO_PROBE_STEMS_CHANGED');
  const voicePath=join(baseline.root,'audio','archived','track.wav');await mkdir(join(voicePath,'..'),{recursive:true,mode:0o700});await frozenAudioInput(voicePath,await readFile(join(proof.root,'objects',data.tracks.voice.audioRef.key)));
  const wav=await inspectTrackWav(voicePath,data.totalSamples,true);if(canonicalHash(wav)!==canonicalHash(data.tracks.voice.wav))throw Error('AUDIO_PROBE_VOICE_CHANGED');
  const master=await buildAudioMaster(baseline.root,plan,{outputPath:voicePath,runtimeDigest:data.runtimeDigest,wav,kind:'narration_only',qaStatus:'not_checked'},stems,data.durationMs,data.fps,env,{assertActive:baselineFence});
  if(master.track.wav.sha256!==data.tracks.mix.wav.sha256)throw Error('AUDIO_PROBE_DEFAULT_MIX_CHANGED');
  const cancelled=await diagnostic();let checks=0,containerId:string|null=null,containerName:string|null=null,revokeAt:number|null=null,errorCode='';
  async function active(){
   if(++checks===3){
    const ids=await docker(['ps','--all','--quiet','--no-trunc','--filter','ancestor='+env.VIDEO_MEDIA_IMAGE_REF,'--filter','label=videobuddy.invocation']);
    for(const id of ids.split('\n').filter(Boolean)){
     const [info]=JSON.parse(await docker(['inspect',id]));
     const mount=info.Mounts.find((entry:{Source:string;Destination:string})=>entry.Destination==='/input/job.json'&&(entry.Source.startsWith(join(cancelled.root,'sound')+'/')||entry.Source.startsWith('/host_mnt'+join(cancelled.root,'sound')+'/')));
     if(!mount)continue;
     if(containerId||info.Image!==env.VIDEO_MEDIA_IMAGE_REF||!info.State.Running||!/^\/vb-media-[a-f0-9-]{36}$/.test(info.Name)||info.Config.Labels['videobuddy.invocation']!==info.Name.slice(10))throw Error('AUDIO_PROBE_CONTAINER_IDENTITY_INVALID');
     containerId=id;containerName=info.Name.slice(1);
    }
    const receipt=await cancelProduction(cancelled.projects.store,cancelled.projectId,cancelled.operationId);if(receipt!=='cancelling')throw Error('AUDIO_PROBE_CANCEL_NOT_ACCEPTED');revokeAt=Date.now();
   }
   await cancelled.fence();
  }
  const startedAt=Date.now();try{await buildSoundStems(cancelled.root,plan,data.durationMs,data.fps,env,{assertActive:active});errorCode='STEMS_RETURNED_AFTER_CANCEL'}catch(error){errorCode=error instanceof Error?error.message:''}
  if(errorCode!=='PREVIEW_STALE'||revokeAt===null)throw Error('AUDIO_PROBE_CANCELLATION_FAILED: '+errorCode);
  const remaining=await docker(['ps','--all','--quiet','--no-trunc','--filter','ancestor='+env.VIDEO_MEDIA_IMAGE_REF,'--filter','label=videobuddy.invocation']);if(containerId&&remaining.split('\n').includes(containerId))throw Error('AUDIO_PROBE_CONTAINER_REMAINS');
  const cold=new ProjectStore(new FileStore(cancelled.root)),c=await cold.access(owner,cancelled.projectId);if(c.consentEpoch!==1||c.activeProduction||c.cancelRequestedProductionId!==cancelled.operationId||(await cold.operation(cancelled.projectId,cancelled.operationId))?.status!=='cancelling')throw Error('AUDIO_PROBE_CANCEL_STATE_CHANGED');
  if(networkCalls||canonicalHash(controlBefore)!==canonicalHash((await source.readFresh(prefix+'/control')).value)||canonicalHash(budgetBefore)!==canonicalHash((await source.readFresh(prefix+'/budget')).value))throw Error('AUDIO_PROBE_SOURCE_CHANGED');
  const report={executedAt:new Date().toISOString(),status:'pass',sourceRoot:proof.root,sourcePackageRef:proof.audio.packageRef,runtimeDigest:data.runtimeDigest,baseline:{root:baseline.root,checks:baselineChecks,musicSha256:stems.music.wav.sha256,foleySha256:stems.foley.wav.sha256,mixSha256:master.track.wav.sha256,allHashesMatchArchived:true},cancellation:{root:cancelled.root,projectId:cancelled.projectId,operationId:cancelled.operationId,checks,errorCode,containerId,containerName,phase:containerId?'running_container_observed':'completed_before_return',containerRemoved:containerId?true:null,afterRevocationMs:Date.now()-revokeAt,elapsedMs:Date.now()-startedAt,coldControlFenced:true,operationStatus:'cancelling',stemsReturned:false},networkCalls,sourceControlAndBudgetUnchanged:true,resultPublished:false,limits:'Actual archived model music/foley and intentional zero voice execute with pinned offline Docker and actual isolated FileStore control/cancelProduction fences. Diagnostic controls are initialized expressly for producer testing; this is not a user-approved FilmPackage, full preview pipeline, qualified result, public change operation or proof of physical cleanup. A running container observation followed by absence does not alone prove that the producer was interrupted before completion; this probe does not assert live-stop success.'};
  await writeFile('docs/engineering/evidence/audio-production-cancellation-probe.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,allHashesMatchArchived:true,cancellationPhase:report.cancellation.phase,containerRemoved:report.cancellation.containerRemoved,afterRevocationMs:report.cancellation.afterRevocationMs,networkCalls,resultPublished:false}));
 }finally{globalThis.fetch=previousFetch}
}
main().catch(error=>{console.error(error instanceof Error?error.message:'AUDIO_PRODUCTION_CANCELLATION_PROBE_FAILED');process.exitCode=1});
