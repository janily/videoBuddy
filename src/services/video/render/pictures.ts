import {join} from 'node:path';
import type {ProjectStore} from '@/services/video/storage/project-store';
import type {Environment} from '@/services/video/config/environment';
import {createOrRead,StoreMissing} from '@/services/video/storage/atomic-store';
import {canonicalHash} from '@/services/video/domain/hash';
import {DockerExecutor} from '@/services/video/media/docker-executor';
import type {MediaExecutor} from '@/services/video/media/executor';
import {technicalVideoQa} from '@/services/video/media/technical-qa';
import {assemblePictureSequence,type PictureClip} from '@/services/video/media/picture-sequence';
import {assertApprovedRenderFence,loadApprovedRenderInputs} from './approved-inputs';
type Qa=Awaited<ReturnType<typeof technicalVideoQa>>;
interface PictureRecord{schemaVersion:1;inputHash:string;shots:(PictureClip&{technicalQa:Qa})[];sequence:Awaited<ReturnType<typeof assemblePictureSequence>>;qualityStatus:'technical_only'}
interface Options{root:string;env?:Environment;executor?:MediaExecutor;qa?:typeof technicalVideoQa;assemble?:typeof assemblePictureSequence;pollMs?:number}
export async function renderApprovedPictures(projects:ProjectStore,owner:string,projectId:string,operationId:string,expectedFence:number,options:Options):Promise<PictureRecord>{
 const {root}=options,env=options.env||process.env,inputs=await loadApprovedRenderInputs(projects,owner,projectId,operationId,expectedFence,{root,env});
 const image='sha256:'+inputs.frozen.filmSpec.runtimeDigest,qa=options.qa||technicalVideoQa,executor=options.executor||new DockerExecutor(root,env),key=`projects/${projectId}/approvals/${inputs.approval.approvalId}/picture-stage`;
 const shots:PictureRecord['shots']=[];
 const {width,height,fps,totalFrames}=inputs.frozen.filmSpec.output;
 let stored:PictureRecord|undefined;try{stored=(await projects.store.readFresh<PictureRecord>(key)).value}catch(error){if(!(error instanceof StoreMissing))throw error}
 if(stored&&(stored.schemaVersion!==1||stored.inputHash!==inputs.inputHash||stored.qualityStatus!=='technical_only'||stored.shots.length!==inputs.jobs.length))throw Error('RENDER_STAGE_CONFLICT');
 for(const [index,job] of inputs.jobs.entries()){
  await assertApprovedRenderFence(projects,inputs);
  const shot=inputs.frozen.timeline.shots[index],expected={width,height,durationSec:(job.endFrame-job.startFrame)/fps,fps,audio:false};
  if(stored){const saved=stored.shots[index];if(saved.shotId!==shot.id||saved.stageKey!==job.stageKey||saved.startFrame!==job.startFrame||saved.endFrame!==job.endFrame||saved.sha256!==saved.technicalQa.sha256)throw Error('RENDER_STAGE_CONFLICT')}
  else{
   const handle=await executor.submit(job),deadline=Date.now()+Number(env.VIDEO_MEDIA_TIMEOUT_SECONDS)*1000+30000;
   try{
    let status=await executor.inspect(handle);
    while(status.status==='running'){
     await assertApprovedRenderFence(projects,inputs);
     if(Date.now()>=deadline)throw Error('STAGE_UNKNOWN');
     await new Promise(resolve=>setTimeout(resolve,options.pollMs??1000));status=await executor.inspect(handle);
    }
    if(status.status!=='succeeded'||status.outputs.length!==1||status.outputs[0]!=='output/picture.mp4')throw Error('RENDER_PICTURE_FAILED');
   }catch(error){
    // Stop ACK failure cannot turn an unknown execution into a known success.
    await executor.cancel(handle).catch(()=>undefined);throw error;
   }
  }
  await assertApprovedRenderFence(projects,inputs);
  const technicalQa=await qa(join(root,'media',job.stageKey),image,'output/picture.mp4',expected);
  if(stored&&canonicalHash(technicalQa)!==canonicalHash(stored.shots[index].technicalQa))throw Error('RENDER_OUTPUT_CHANGED');
  shots.push({shotId:shot.id,startFrame:shot.startFrame,endFrame:shot.endFrame,stageKey:job.stageKey,sha256:technicalQa.sha256,technicalQa});
 }
 await assertApprovedRenderFence(projects,inputs);
 const sequence=await (options.assemble||assemblePictureSequence)(root,{projectId,revisionId:inputs.bundle.revisionId,shots:shots.map(({technicalQa,...shot})=>{void technicalQa;return shot}),width,height,fps,runtimeDigest:inputs.frozen.filmSpec.runtimeDigest,fence:inputs.approval.consentEpoch},env,{assertActive:()=>assertApprovedRenderFence(projects,inputs)});
 if(sequence.totalFrames!==totalFrames)throw Error('RENDER_OUTPUT_CHANGED');
 const record:PictureRecord={schemaVersion:1,inputHash:inputs.inputHash,shots,sequence,qualityStatus:'technical_only'};
 // Re-read every immutable source and approval before recording completion.
 const latest=await loadApprovedRenderInputs(projects,owner,projectId,operationId,expectedFence,{root,env});
 if(latest.inputHash!==inputs.inputHash)throw Error('RENDER_FENCED');
 if(stored&&canonicalHash(stored)!==canonicalHash(record))throw Error('RENDER_OUTPUT_CHANGED');
 const saved=await createOrRead(projects.store,key,record);if(canonicalHash(saved)!==canonicalHash(record))throw Error('RENDER_STAGE_CONFLICT');return record;
}
