import {join} from 'node:path';
import type {ObjectRef,Understanding} from '@/contracts/video/domain';
import type {ProjectControl} from '@/contracts/video/project';
import type {VisualShotSource} from '@/contracts/video/visual-shot';
import type {Environment} from '@/services/video/config/environment';
import {canonicalHash,canonicalJson} from '@/services/video/domain/hash';
import {computeStageKey,DockerExecutor,dockerConfiguration} from '@/services/video/media/docker-executor';
import type {MediaExecutor,MediaJob} from '@/services/video/media/executor';
import {technicalVideoQa} from '@/services/video/media/technical-qa';
import {createOrRead,StoreMissing} from '@/services/video/storage/atomic-store';
import type {ProjectStore} from '@/services/video/storage/project-store';
import {assertPreviewProductionFence} from './fence';
import {TimingDraftSchema} from './timing-draft';
import {prepareTimingStage} from './timing-stage';
import {prepareVisualShotStage} from './visual-stage';

type Qa=typeof technicalVideoQa;
type Profile='full'|'probe';
interface Options{root?:string;env?:Environment;executor?:MediaExecutor;qa?:Qa;profile?:Profile;pollMs?:number}
export interface PictureShotRecord{
 schemaVersion:1;briefVersion:number;treatmentSha256:string;timingDraftSha256:string;visualSourceSha256:string;
 shotId:string;profile:Profile;stageKey:string;runtimeDigest:string;outputPath:string;
 technicalQa:Awaited<ReturnType<Qa>>;
}

async function readRef<T>(projects:ProjectStore,ref:ObjectRef,prefix:string):Promise<T>{
 if(ref.mime!=='application/json'||ref.bytes<1||!ref.key.startsWith(prefix))throw Error('PICTURE_REF_CHANGED');
 let value:T;try{value=(await projects.store.readFresh<T>(ref.key)).value}catch{throw Error('PICTURE_REF_CHANGED')}
 if(canonicalHash(value)!==ref.sha256||Buffer.byteLength(canonicalJson(value))!==ref.bytes)throw Error('PICTURE_REF_CHANGED');
 return value;
}

export async function preparePictureShotStage(projects:ProjectStore,projectId:string,revisionId:string,operationId:string,expectedConsentEpoch:number,treatmentRef:ObjectRef,shotId:string,options:Options={}):Promise<PictureShotRecord>{
 const env=options.env||process.env,root=options.root||env.VIDEO_DATA_DIR,profile=options.profile||'full';
 if(!root||!root.startsWith('/')||!['full','probe'].includes(profile))throw Error('CONFIGURATION_REQUIRED: VIDEO_DATA_DIR');
 const prefix=`projects/${projectId}`,revisionPrefix=`${prefix}/revisions/${revisionId}/`;
 const control=(await projects.store.readFresh<ProjectControl>(`${prefix}/control`)).value;
 assertPreviewProductionFence(control,projectId,operationId,expectedConsentEpoch);
 const understanding=await readRef<Understanding>(projects,control.understandingRef,`${prefix}/understanding/`);
 const timingRecord=await prepareTimingStage(projects,projectId,revisionId,operationId,expectedConsentEpoch,treatmentRef,{root,env,mustExist:true});
 const timing=TimingDraftSchema.parse(await readRef<unknown>(projects,timingRecord.draftRef,revisionPrefix));
 const visual=await prepareVisualShotStage(projects,projectId,revisionId,operationId,expectedConsentEpoch,treatmentRef,shotId,{root,env,mustExist:true});
 const source=await readRef<VisualShotSource>(projects,visual.sourceRef,`${revisionPrefix}visual-source/`);
 if(source.assetIds.length)throw Error('VISUAL_ASSET_RUNTIME_UNAVAILABLE');
 const landscape=understanding.preferences.aspect==='16:9',logicalWidth=landscape?1920:1080,logicalHeight=landscape?1080:1920;
 const outputWidth=profile==='probe'?(landscape?320:180):logicalWidth,outputHeight=profile==='probe'?(landscape?180:320):logicalHeight;
 const shotKey=canonicalHash({shotId}),key=`${revisionPrefix}picture/${profile}/${shotKey}`;
 const config=dockerConfiguration(env,operationId);
 const bundleHash=canonicalHash({revisionId,treatmentSha256:treatmentRef.sha256,timingDraftSha256:timingRecord.draftRef.sha256,visualSourceSha256:visual.sourceSha256,shotId});
 const parameters={projectId,bundleHash,runtimeDigest:config.runtimeDigest,sourceHtml:source.sourceHtml,logicalWidth,logicalHeight,outputWidth,outputHeight,fps:timing.fps,startFrame:source.startFrame,endFrame:source.endFrame,seed:Number.parseInt(bundleHash.slice(0,8),16),fence:expectedConsentEpoch};
 const stageKey=computeStageKey(parameters),stageDir=join(root,'media',stageKey),outputPath=join(stageDir,'output','picture.mp4');
 const expected={width:outputWidth,height:outputHeight,durationSec:(source.endFrame-source.startFrame)/timing.fps,fps:timing.fps,audio:false};
 const qa=options.qa||technicalVideoQa;
 async function verify(record:PictureShotRecord){
  if(record.schemaVersion!==1||record.briefVersion!==control.briefVersion||record.treatmentSha256!==treatmentRef.sha256||record.timingDraftSha256!==timingRecord.draftRef.sha256||record.visualSourceSha256!==visual.sourceSha256||record.shotId!==shotId||record.profile!==profile||record.stageKey!==stageKey||record.runtimeDigest!==config.runtimeDigest||record.outputPath!==outputPath)throw Error('PICTURE_STAGE_CONFLICT');
  const actual=await qa(stageDir,config.image,'output/picture.mp4',expected);
  if(canonicalHash(actual)!==canonicalHash(record.technicalQa))throw Error('PICTURE_OUTPUT_CHANGED');
  const latest=(await projects.store.readFresh<ProjectControl>(`${prefix}/control`)).value;
  assertPreviewProductionFence(latest,projectId,operationId,expectedConsentEpoch,{briefVersion:control.briefVersion,understandingRef:control.understandingRef});
  return record;
 }
 try{return await verify((await projects.store.readFresh<PictureShotRecord>(key)).value)}catch(error){if(!(error instanceof StoreMissing))throw error}
 const executor=options.executor||new DockerExecutor(root),job:MediaJob={...parameters,operationId,attemptId:`picture-${profile}-${shotKey.slice(0,12)}`,stageKey};
 const handle=await executor.submit(job),deadline=Date.now()+config.timeoutSeconds*1000+30000,pollMs=options.pollMs??1000;
 let status=await executor.inspect(handle);
 while(status.status==='running'&&Date.now()<deadline){
  const latest=(await projects.store.readFresh<ProjectControl>(`${prefix}/control`)).value;
  try{assertPreviewProductionFence(latest,projectId,operationId,expectedConsentEpoch,{briefVersion:control.briefVersion,understandingRef:control.understandingRef})}
  catch(error){await executor.cancel(handle);throw error}
  await new Promise(resolve=>setTimeout(resolve,pollMs));status=await executor.inspect(handle);
 }
 if(status.status==='running')throw Error('STAGE_UNKNOWN');
 if(status.status!=='succeeded'||status.outputs.length!==1||status.outputs[0]!=='output/picture.mp4')throw Error(`PICTURE_RENDER_FAILED: ${status.errorCode||status.status}`);
 const technicalQa=await qa(stageDir,config.image,'output/picture.mp4',expected);
 const checkedVisual=await prepareVisualShotStage(projects,projectId,revisionId,operationId,expectedConsentEpoch,treatmentRef,shotId,{root,env,mustExist:true});
 if(checkedVisual.sourceSha256!==visual.sourceSha256||checkedVisual.sourceRef.sha256!==visual.sourceRef.sha256)throw Error('PICTURE_SOURCE_CHANGED');
 const latest=(await projects.store.readFresh<ProjectControl>(`${prefix}/control`)).value;
 assertPreviewProductionFence(latest,projectId,operationId,expectedConsentEpoch,{briefVersion:control.briefVersion,understandingRef:control.understandingRef});
 const record:PictureShotRecord={schemaVersion:1,briefVersion:control.briefVersion,treatmentSha256:treatmentRef.sha256,timingDraftSha256:timingRecord.draftRef.sha256,visualSourceSha256:visual.sourceSha256,shotId,profile,stageKey,runtimeDigest:config.runtimeDigest,outputPath,technicalQa};
 const stored=await createOrRead(projects.store,key,record);
 if(canonicalHash(stored)!==canonicalHash(record))throw Error('PICTURE_STAGE_CONFLICT');
 return verify(stored);
}
