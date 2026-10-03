import {spawn} from 'node:child_process';
import {mkdtemp,mkdir,readFile,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {FileStore} from '../../src/services/video/storage/file-store';
import {loadAudioExecution,AudioExecutionSchema} from '../../src/services/video/audio/execution-package';
import {AudioPlanSchema} from '../../src/contracts/video/audio-plan';
import {buildAudioMaster} from '../../src/services/video/audio/master';
import {frozenAudioInput} from '../../src/services/video/audio/sound';
import {canonicalHash} from '../../src/services/video/domain/hash';
import {inspectTrackWav,inspectStereoTrackWav} from '../../src/services/video/audio/wav';
async function docker(args:string[]){
 const child=spawn('docker',args,{stdio:['ignore','pipe','pipe'],signal:AbortSignal.timeout(15000)}),chunks:Buffer[]=[];let size=0;
 child.stdout.on('data',(chunk:Buffer)=>{size+=chunk.length;if(size<=65536)chunks.push(chunk)});child.stderr.resume();
 const code=await new Promise<number>((resolve,reject)=>{child.once('error',reject);child.once('close',value=>resolve(value??1))});
 if(code!==0||size>65536)throw Error('CANCELLATION_PROBE_DOCKER_UNKNOWN');return Buffer.concat(chunks).toString('utf8').trim();
}
function repeatedWav(bytes:Buffer){
 let offset=12;while(offset+8<=bytes.length){const length=bytes.readUInt32LE(offset+4);if(bytes.toString('ascii',offset,offset+4)==='data'){
  const samples=bytes.subarray(offset+8,offset+8+length),channels=bytes.readUInt16LE(22),header=Buffer.alloc(44),body=Buffer.concat(Array.from({length:6},()=>samples));
  header.write('RIFF');header.writeUInt32LE(body.length+36,4);header.write('WAVEfmt ',8);header.writeUInt32LE(16,16);header.writeUInt16LE(3,20);header.writeUInt16LE(channels,22);header.writeUInt32LE(48000,24);header.writeUInt32LE(48000*channels*4,28);header.writeUInt16LE(channels*4,32);header.writeUInt16LE(32,34);header.write('data',36);header.writeUInt32LE(body.length,40);return Buffer.concat([header,body]);
 }offset+=8+length+length%2}throw Error('CANCELLATION_PROBE_PCM_MISSING');
}
async function main(){
 if(!process.argv.includes('--master-cancellation'))throw Error('MASTER_CANCELLATION_OPT_IN_REQUIRED');
 const proof=JSON.parse(await readFile('docs/engineering/evidence/native-package-probe.json','utf8')),store=new FileStore(proof.root),prefix=`projects/${proof.projectId}`;
 const controlBefore=(await store.readFresh(prefix+'/control')).value,budgetBefore=(await store.readFresh(prefix+'/budget')).value;
 const data=AudioExecutionSchema.parse((await store.readFresh(proof.audio.packageRef.key)).value);
 await loadAudioExecution(store,proof.root,proof.projectId,proof.revisionId,proof.audio.packageRef,data.planRef,data.timingDraftRef);
 const plan=AudioPlanSchema.parse((await store.readFresh(data.planRef.key)).value),root=await mkdtemp(resolve('.video-local/music-master-cancel-')),digest=data.runtimeDigest,image='sha256:'+digest;
 const env={VIDEO_MEDIA_IMAGE_REF:image,VIDEO_MEDIA_RUNTIME_DIGEST:digest,VIDEO_MEDIA_TIMEOUT_SECONDS:'180'};
 const paths={voice:join(root,'audio','archived','track.wav'),music:join(root,'sound',data.sound.stageKey,'output','music.wav'),foley:join(root,'sound',data.sound.stageKey,'output','foley.wav')};
 let networkCalls=0;const originalFetch=globalThis.fetch;globalThis.fetch=async()=>{networkCalls++;throw Error('CANCELLATION_PROBE_NETWORK_FORBIDDEN')};
 try{
  for(const bus of ['voice','music','foley'] as const){await mkdir(join(paths[bus],'..'),{recursive:true,mode:0o700});await frozenAudioInput(paths[bus],await readFile(join(proof.root,'objects',data.tracks[bus].audioRef.key)))}
  const voice=await inspectTrackWav(paths.voice,data.totalSamples,true),music=await inspectStereoTrackWav(paths.music,data.totalSamples,false),foley=await inspectStereoTrackWav(paths.foley,data.totalSamples,true);
  for(const [bus,wav] of [['voice',voice],['music',music],['foley',foley]] as const)if(canonicalHash(wav)!==canonicalHash(data.tracks[bus].wav))throw Error('CANCELLATION_PROBE_INPUT_CHANGED');
  let narration={outputPath:paths.voice,runtimeDigest:digest,wav:voice,kind:'narration_only' as const,qaStatus:'not_checked' as const},stems={...data.sound,runtimeDigest:digest,music:{outputPath:paths.music,wav:music},foley:{outputPath:paths.foley,wav:foley},qualityStatus:'listening_not_checked' as const};
  let baselineChecks=0;const baseline=await buildAudioMaster(root,plan,narration,stems,data.durationMs,data.fps,env,{assertActive:async()=>{baselineChecks++}});
  if(baseline.track.wav.sha256!==data.tracks.mix.wav.sha256)throw Error('CANCELLATION_PROBE_BASELINE_CHANGED');
  const loadTest=process.argv.includes('--load-120'),durationMs=loadTest?120000:data.durationMs;
  if(loadTest){
   // Explicit execution load test, not a 120-second authored movie: repeat each
   // actual archived bus six times so a live mixer can be observed and stopped.
   const loadPaths={voice:join(root,'audio','load','track.wav'),music:join(root,'sound','load','music.wav'),foley:join(root,'sound','load','foley.wav')};
   for(const bus of ['voice','music','foley'] as const){await mkdir(join(loadPaths[bus],'..'),{recursive:true,mode:0o700});await frozenAudioInput(loadPaths[bus],repeatedWav(await readFile(paths[bus])))}
   narration={...narration,outputPath:loadPaths.voice,wav:await inspectTrackWav(loadPaths.voice,durationMs*48,true)};
   stems={...stems,music:{outputPath:loadPaths.music,wav:await inspectStereoTrackWav(loadPaths.music,durationMs*48,false)},foley:{outputPath:loadPaths.foley,wav:await inspectStereoTrackWav(loadPaths.foley,durationMs*48,true)}};
  }
  let checks=0,containerId:string|null=null,invocation:string|null=null,name:string|null=null,revokeAt:number|null=null,errorCode='';
  const active=async()=>{
   if(++checks<3)return;
   if(revokeAt===null){
    const candidates=await docker(['ps','--all','--quiet','--no-trunc','--filter','ancestor='+image,'--filter','label=videobuddy.invocation']);
    for(const id of candidates.split('\n').filter(Boolean)){
     const [info]=JSON.parse(await docker(['inspect',id]));
     if(info.Image!==image||!info.Mounts.some((mount:{Source:string;Destination:string})=>mount.Destination==='/input/job.json'&&mount.Source.startsWith(join(root,'audio-master')+'/')))continue;
     if(containerId||!info.State.Running||!/^vb-media-[a-f0-9-]{36}$/.test(info.Name.slice(1))||info.Config.Labels['videobuddy.invocation']!==info.Name.slice(10))throw Error('CANCELLATION_PROBE_IDENTITY_INVALID');
     containerId=id;name=info.Name.slice(1);invocation=info.Config.Labels['videobuddy.invocation'];
    }
    revokeAt=Date.now();
   }
   throw Error('RENDER_FENCED');
  };
  const startedAt=Date.now();try{await buildAudioMaster(root,plan,narration,stems,durationMs,data.fps,env,{musicGainDb:-3,assertActive:active});errorCode='MIX_RETURNED_AFTER_REVOCATION'}catch(error){errorCode=error instanceof Error?error.message:''}
  if(errorCode!=='RENDER_FENCED'||revokeAt===null)throw Error('CANCELLATION_PROBE_NOT_FENCED: '+errorCode);
  const remaining=await docker(['ps','--all','--quiet','--no-trunc','--filter','ancestor='+image,'--filter','label=videobuddy.invocation']);
  if(containerId&&remaining.split('\n').includes(containerId))throw Error('CANCELLATION_PROBE_CONTAINER_REMAINS');
  if(networkCalls||canonicalHash(controlBefore)!==canonicalHash((await store.readFresh(prefix+'/control')).value)||canonicalHash(budgetBefore)!==canonicalHash((await store.readFresh(prefix+'/budget')).value))throw Error('CANCELLATION_PROBE_SOURCE_CHANGED');
  const report={executedAt:new Date().toISOString(),status:'pass',root,sourceRoot:proof.root,packageRef:proof.audio.packageRef,runtimeDigest:digest,baselineMatchesArchivedMix:true,baselineChecks,checks,errorCode,containerId,name,invocation,cancellationPhase:containerId?'running_container_observed':'completed_before_return',containerRemoved:containerId?true:null,durationMs,loadTestInput:loadTest?'six_repetitions_of_archived_buses':'original_archived_buses',elapsedMs:Date.now()-startedAt,afterRevocationMs:Date.now()-revokeAt,networkCalls,sourceControlAndBudgetUnchanged:true,mixReturned:false,resultPublished:false,limits:'Actual archived model music/foley and zero voice run through the pinned offline master producer. Optional 120-second mode is a producer load test using six repeated copies of each archived bus, not an authored movie or valid film package. Diagnostic callback revokes only this invocation, not the original project. Running-container cancellation is claimed only if a live container with exact image/label/job mount was observed. Not a public change operation, full movie QA or new result.'};
  await writeFile('docs/engineering/evidence/music-master-cancellation-'+(loadTest?'load':'probe')+'.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,cancellationPhase:report.cancellationPhase,containerRemoved:report.containerRemoved,afterRevocationMs:report.afterRevocationMs,networkCalls,resultPublished:false}));
 }finally{globalThis.fetch=originalFetch}
}
main().catch(error=>{console.error(error instanceof Error?error.message:'MASTER_CANCELLATION_PROBE_FAILED');process.exitCode=1});
