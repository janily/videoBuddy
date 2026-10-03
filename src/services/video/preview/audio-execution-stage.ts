import {isAbsolute} from 'node:path';
import {z} from 'zod';
import {ObjectRefSchema,type ObjectRef} from '@/contracts/video/domain';
import type {ProjectControl} from '@/contracts/video/project';
import {AudioPlanSchema} from '@/contracts/video/audio-plan';
import {archiveAudioExecution,loadAudioExecution} from '@/services/video/audio/execution-package';
import {buildSoundStems} from '@/services/video/audio/sound';
import {buildAudioMaster} from '@/services/video/audio/master';
import {inspectTrackWav} from '@/services/video/audio/wav';
import {readNarrationJson} from '@/services/video/audio/narration-package';
import {canonicalHash} from '@/services/video/domain/hash';
import {dockerConfiguration} from '@/services/video/media/docker-executor';
import type {Environment} from '@/services/video/config/environment';
import {createOrRead,StoreMissing} from '@/services/video/storage/atomic-store';
import type {ProjectStore} from '@/services/video/storage/project-store';
import {prepareAudioPlanStage} from './audio-plan-stage';
import {prepareTimingStage} from './timing-stage';
import {TimingDraftSchema} from './timing-draft';
import {assertPreviewProductionFence} from './fence';

const digest=z.string().regex(/^[a-f0-9]{64}$/);
const RecordSchema=z.strictObject({schemaVersion:z.literal(2),briefVersion:z.number().int().nonnegative(),understandingSha256:digest,treatmentSha256:digest,timingDraftSha256:digest,audioPlanSha256:digest,runtimeDigest:digest,packageRef:ObjectRefSchema,qualityStatus:z.literal('listening_not_checked')});
export type AudioExecutionStageRecord=z.infer<typeof RecordSchema>;
interface Options{root?:string;env?:Environment;mustExist?:boolean}

export async function prepareAudioExecutionStage(projects:ProjectStore,projectId:string,revisionId:string,operationId:string,expectedConsentEpoch:number,treatmentRef:ObjectRef,options:Options={}):Promise<AudioExecutionStageRecord>{
 if(![projectId,revisionId,operationId].every(id=>z.uuid().safeParse(id).success)||!Number.isSafeInteger(expectedConsentEpoch)||expectedConsentEpoch<0)throw Error('VALIDATION_FAILED');
 const env=options.env||process.env,root=options.root||env.VIDEO_DATA_DIR;
 if(!root||!isAbsolute(root))throw Error('CONFIGURATION_REQUIRED: VIDEO_DATA_DIR');
 const prefix='projects/'+projectId,revisionPrefix=prefix+'/revisions/'+revisionId+'/',key=revisionPrefix+'audio-execution-v2-stage';
 const control=(await projects.store.readFresh<ProjectControl>(prefix+'/control')).value;
 assertPreviewProductionFence(control,projectId,operationId,expectedConsentEpoch);
 const audio=await prepareAudioPlanStage(projects,projectId,revisionId,operationId,expectedConsentEpoch,treatmentRef,{root,env,mustExist:true});
 const timingRecord=await prepareTimingStage(projects,projectId,revisionId,operationId,expectedConsentEpoch,treatmentRef,{root,env,mustExist:true});
 const timing=TimingDraftSchema.parse(await readNarrationJson(projects.store,timingRecord.draftRef,revisionPrefix+'timing-draft/')),plan=AudioPlanSchema.parse(await readNarrationJson(projects.store,audio.planRef,revisionPrefix+'audio-plan/'));
 const config=dockerConfiguration(env,operationId);
 if(config.runtimeDigest!==timing.track.runtimeDigest)throw Error('AUDIO_RUNTIME_CHANGED');
 const baseline={schemaVersion:2 as const,briefVersion:control.briefVersion,understandingSha256:control.understandingRef.sha256,treatmentSha256:treatmentRef.sha256,timingDraftSha256:timingRecord.draftRef.sha256,audioPlanSha256:audio.planRef.sha256,runtimeDigest:config.runtimeDigest,qualityStatus:'listening_not_checked' as const};
 async function fence(){const latest=(await projects.store.readFresh<ProjectControl>(prefix+'/control')).value;assertPreviewProductionFence(latest,projectId,operationId,expectedConsentEpoch,{briefVersion:control.briefVersion,understandingRef:control.understandingRef})}
 async function verify(raw:unknown){
  const parsed=RecordSchema.safeParse(raw);if(!parsed.success)throw Error('AUDIO_EXECUTION_CONFLICT');
  const{packageRef,...saved}=parsed.data;
  if(canonicalHash(saved)!==canonicalHash(baseline))throw Error('AUDIO_EXECUTION_CONFLICT');
  await loadAudioExecution(projects.store,root!,projectId,revisionId,packageRef,audio.planRef,timingRecord.draftRef);
  await fence();return parsed.data;
 }
 try{return await verify((await projects.store.readFresh<unknown>(key)).value)}catch(error){if(!(error instanceof StoreMissing))throw error}
 if(options.mustExist)throw Error('AUDIO_EXECUTION_MISSING');
 const wav=await inspectTrackWav(timing.track.outputPath,timing.durationMs*48,timing.track.silence);
 if(wav.sha256!==timing.track.sha256)throw Error('AUDIO_EXECUTION_CHANGED');
 const voice={outputPath:timing.track.outputPath,runtimeDigest:timing.track.runtimeDigest,wav,kind:'narration_only' as const,qaStatus:'not_checked' as const};
 await fence();
 const stems=await buildSoundStems(root,plan,timing.durationMs,timing.fps,env);
 await fence();
 const master=await buildAudioMaster(root,plan,voice,stems,timing.durationMs,timing.fps,env);
 await fence();
 const packageRef=await archiveAudioExecution(projects,root,projectId,revisionId,audio.planRef,timingRecord.draftRef,voice,stems,master);
 await fence();
 const record={...baseline,packageRef};await verify(record);
 const saved=await createOrRead(projects.store,key,record);
 if(canonicalHash(saved)!==canonicalHash(record))throw Error('AUDIO_EXECUTION_CONFLICT');
 return verify(saved);
}
