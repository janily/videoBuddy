import {join} from 'node:path';
import type {ObjectRef,Understanding} from '@/contracts/video/domain';
import type {ProjectControl} from '@/contracts/video/project';
import type {Environment} from '@/services/video/config/environment';
import {canonicalHash,canonicalJson} from '@/services/video/domain/hash';
import {dockerConfiguration} from '@/services/video/media/docker-executor';
import {assemblePictureSequence,pictureSequenceStageKey,type PictureSequenceInput} from '@/services/video/media/picture-sequence';
import {technicalVideoQa} from '@/services/video/media/technical-qa';
import {createOrRead,StoreMissing} from '@/services/video/storage/atomic-store';
import type {ProjectStore} from '@/services/video/storage/project-store';
import {assertPreviewProductionFence} from './fence';
import {preparePictureShotStage} from './picture-stage';
import {TimingDraftSchema} from './timing-draft';
import {prepareTimingStage} from './timing-stage';

type Profile='full'|'preview'|'probe';
type Qa=typeof technicalVideoQa;
type Assemble=typeof assemblePictureSequence;
interface Options{root?:string;env?:Environment;profile?:Profile;qa?:Qa;assemble?:Assemble;mustExist?:boolean}
export interface PictureSequenceRecord{schemaVersion:1;briefVersion:number;treatmentSha256:string;timingDraftSha256:string;inputHash:string;profile:Profile;stageKey:string;outputPath:string;totalFrames:number;technicalQa:Awaited<ReturnType<Qa>>}

async function readRef<T>(projects:ProjectStore,ref:ObjectRef,prefix:string):Promise<T>{
 if(ref.mime!=='application/json'||ref.bytes<1||!ref.key.startsWith(prefix))throw Error('PICTURE_SEQUENCE_REF_CHANGED');
 let value:T;try{value=(await projects.store.readFresh<T>(ref.key)).value}catch{throw Error('PICTURE_SEQUENCE_REF_CHANGED')}
 if(canonicalHash(value)!==ref.sha256||Buffer.byteLength(canonicalJson(value))!==ref.bytes)throw Error('PICTURE_SEQUENCE_REF_CHANGED');
 return value;
}
export async function preparePictureSequenceStage(projects:ProjectStore,projectId:string,revisionId:string,operationId:string,expectedConsentEpoch:number,treatmentRef:ObjectRef,options:Options={}):Promise<PictureSequenceRecord>{
 const env=options.env||process.env,root=options.root||env.VIDEO_DATA_DIR,profile=options.profile||'full';
 if(!root||!root.startsWith('/')||!['full','preview','probe'].includes(profile))throw Error('CONFIGURATION_REQUIRED: VIDEO_DATA_DIR');
 const prefix=`projects/${projectId}`,revisionPrefix=`${prefix}/revisions/${revisionId}/`;
 const control=(await projects.store.readFresh<ProjectControl>(`${prefix}/control`)).value;
 assertPreviewProductionFence(control,projectId,operationId,expectedConsentEpoch);
 const understanding=await readRef<Understanding>(projects,control.understandingRef,`${prefix}/understanding/`);
 const timingRecord=await prepareTimingStage(projects,projectId,revisionId,operationId,expectedConsentEpoch,treatmentRef,{root,env,mustExist:true});
 const timing=TimingDraftSchema.parse(await readRef<unknown>(projects,timingRecord.draftRef,revisionPrefix));
 const landscape=understanding.preferences.aspect==='16:9',width=profile==='probe'?(landscape?320:180):profile==='preview'?(landscape?1280:720):(landscape?1920:1080),height=profile==='probe'?(landscape?180:320):profile==='preview'?(landscape?720:1280):(landscape?1080:1920);
 const config=dockerConfiguration(env,operationId),qa=options.qa||technicalVideoQa;
 const shots=[];
 for(const shot of timing.shots){
  const record=await preparePictureShotStage(projects,projectId,revisionId,operationId,expectedConsentEpoch,treatmentRef,shot.id,{root,env,profile,qa,mustExist:true});
  shots.push({shotId:shot.id,startFrame:shot.startFrame,endFrame:shot.endFrame,stageKey:record.stageKey,sha256:record.technicalQa.sha256});
 }
 const input:PictureSequenceInput={projectId,revisionId,shots,width,height,fps:timing.fps,runtimeDigest:config.runtimeDigest,fence:expectedConsentEpoch};
 const inputHash=canonicalHash(input),stageKey=pictureSequenceStageKey(input),stageDir=join(root,'picture-sequence',stageKey),outputPath=join(stageDir,'output','picture.mp4'),key=`${revisionPrefix}picture-sequence/${profile}`;
 const expected={width,height,durationSec:timing.totalFrames/timing.fps,fps:timing.fps,audio:false};
 async function verify(record:PictureSequenceRecord){
  if(record.schemaVersion!==1||record.briefVersion!==control.briefVersion||record.treatmentSha256!==treatmentRef.sha256||record.timingDraftSha256!==timingRecord.draftRef.sha256||record.inputHash!==inputHash||record.profile!==profile||record.stageKey!==stageKey||record.outputPath!==outputPath||record.totalFrames!==timing.totalFrames)throw Error('PICTURE_SEQUENCE_CONFLICT');
  const actual=await qa(stageDir,config.image,'output/picture.mp4',expected);
  if(canonicalHash(actual)!==canonicalHash(record.technicalQa))throw Error('PICTURE_SEQUENCE_OUTPUT_CHANGED');
  const latest=(await projects.store.readFresh<ProjectControl>(`${prefix}/control`)).value;
  assertPreviewProductionFence(latest,projectId,operationId,expectedConsentEpoch,{briefVersion:control.briefVersion,understandingRef:control.understandingRef});
  return record;
 }
 try{return await verify((await projects.store.readFresh<PictureSequenceRecord>(key)).value)}catch(error){if(!(error instanceof StoreMissing))throw error}
 if(options.mustExist)throw Error('PICTURE_SEQUENCE_MISSING');
 const assembled=await (options.assemble||assemblePictureSequence)(root,input,env);
 if(assembled.stageKey!==stageKey||assembled.outputPath!==outputPath||assembled.totalFrames!==timing.totalFrames)throw Error('PICTURE_SEQUENCE_INVALID');
 for(const shot of timing.shots){
  const current=await preparePictureShotStage(projects,projectId,revisionId,operationId,expectedConsentEpoch,treatmentRef,shot.id,{root,env,profile,qa,mustExist:true});
  if(current.stageKey!==shots.find(item=>item.shotId===shot.id)?.stageKey)throw Error('PICTURE_SOURCE_CHANGED');
 }
 const latest=(await projects.store.readFresh<ProjectControl>(`${prefix}/control`)).value;
 assertPreviewProductionFence(latest,projectId,operationId,expectedConsentEpoch,{briefVersion:control.briefVersion,understandingRef:control.understandingRef});
 const record:PictureSequenceRecord={schemaVersion:1,briefVersion:control.briefVersion,treatmentSha256:treatmentRef.sha256,timingDraftSha256:timingRecord.draftRef.sha256,inputHash,profile,stageKey,outputPath,totalFrames:timing.totalFrames,technicalQa:assembled.technicalQa};
 const stored=await createOrRead(projects.store,key,record);
 if(canonicalHash(stored)!==canonicalHash(record))throw Error('PICTURE_SEQUENCE_CONFLICT');
 return verify(stored);
}
