import {randomUUID} from 'node:crypto';
import {isAbsolute,join} from 'node:path';
import {z} from 'zod';
import type {ObjectRef} from '@/contracts/video/domain';
import type {ProjectControl} from '@/contracts/video/project';
import type {Environment} from '@/services/video/config/environment';
import {canonicalHash,canonicalJson} from '@/services/video/domain/hash';
import {dockerConfiguration} from '@/services/video/media/docker-executor';
import {technicalVideoQa} from '@/services/video/media/technical-qa';
import {createOrRead,StoreMissing} from '@/services/video/storage/atomic-store';
import type {ProjectStore} from '@/services/video/storage/project-store';
import {stagePreviewArtifact} from './artifact';
import type {ExcerptSegment} from './excerpt';
import {assertPreviewProductionFence} from './fence';
import {prepareCompositeStage} from './composite-stage';
import {previewExcerptStageKey,renderPreviewExcerpt,validatePreviewSegments,validatePreviewSpeechCoverage} from './render-excerpt';
import {TimingDraftSchema} from './timing-draft';
import {prepareTimingStage} from './timing-stage';

type Profile='full'|'preview'|'probe';
type Qa=typeof technicalVideoQa;
type Render=typeof renderPreviewExcerpt;
type StageArtifact=typeof stagePreviewArtifact;
interface Options{root?:string;env?:Environment;profile?:Profile;qa?:Qa;render?:Render;stageArtifact?:StageArtifact;composite?:Parameters<typeof prepareCompositeStage>[6]}
interface ExcerptIntent{inputHash:string;artifactId:string}
export interface PreviewExcerptRecord{
 schemaVersion:1;briefVersion:number;treatmentSha256:string;timingDraftSha256:string;compositeHash:string;profile:Profile;
 excerptMap:ExcerptSegment[];stageKey:string;outputPath:string;sourceFilmSha256:string;durationMs:number;artifactId:string;
 previewArtifactSha256:string;technicalQa:Awaited<ReturnType<Qa>>;qualityStatus:'semantic_not_checked';
}
async function readRef<T>(projects:ProjectStore,ref:ObjectRef,prefix:string):Promise<T>{
 if(ref.mime!=='application/json'||ref.bytes<1||!ref.key.startsWith(prefix))throw Error('PREVIEW_REF_CHANGED');
 let value:T;try{value=(await projects.store.readFresh<T>(ref.key)).value}catch{throw Error('PREVIEW_REF_CHANGED')}
 if(canonicalHash(value)!==ref.sha256||Buffer.byteLength(canonicalJson(value))!==ref.bytes)throw Error('PREVIEW_REF_CHANGED');
 return value;
}

export async function preparePreviewExcerptStage(projects:ProjectStore,projectId:string,revisionId:string,operationId:string,expectedConsentEpoch:number,treatmentRef:ObjectRef,segments:ExcerptSegment[],options:Options={}):Promise<PreviewExcerptRecord>{
 if(![projectId,revisionId,operationId].every(id=>z.uuid().safeParse(id).success))throw Error('VALIDATION_FAILED');
 const env=options.env||process.env,root=options.root||env.VIDEO_DATA_DIR,profile=options.profile||'preview';
 if(!root||!isAbsolute(root)||!['full','preview','probe'].includes(profile))throw Error('CONFIGURATION_REQUIRED: VIDEO_DATA_DIR');
 const dataRoot:string=root;
 const prefix=`projects/${projectId}`,revisionPrefix=`${prefix}/revisions/${revisionId}/`,control=(await projects.store.readFresh<ProjectControl>(`${prefix}/control`)).value;
 assertPreviewProductionFence(control,projectId,operationId,expectedConsentEpoch);
 const timingRecord=await prepareTimingStage(projects,projectId,revisionId,operationId,expectedConsentEpoch,treatmentRef,{root,env,mustExist:true});
 const timing=TimingDraftSchema.parse(await readRef<unknown>(projects,timingRecord.draftRef,revisionPrefix));
 const {durationMs,totalFrames}=validatePreviewSegments(segments,timing.durationMs,timing.fps);
 const shots=new Map(timing.shots.map(shot=>[shot.id,shot]));
 for(const segment of segments){
  const shot=shots.get(segment.shotId!),startFrame=segment.sourceStartMs!*timing.fps/1000,endFrame=segment.sourceEndMs!*timing.fps/1000;
  if(!shot||startFrame<shot.startFrame||endFrame>shot.endFrame)throw Error('EXCERPT_SHOT_CHANGED');
 }
 const speechWindows=timing.narration.map(line=>({startMs:line.startSample/48,endMs:line.endSample/48}));
 validatePreviewSpeechCoverage(segments,speechWindows,timing.durationMs);
 const composite=await prepareCompositeStage(projects,projectId,revisionId,operationId,expectedConsentEpoch,treatmentRef,{...options.composite,root,env,profile});
 const config=dockerConfiguration(env,operationId),width=composite.technicalQa.width,height=composite.technicalQa.height,fps=timing.fps;
 const stageKey=previewExcerptStageKey({fullFilmSha256:composite.technicalQa.sha256,segments,width,height,fps,runtimeDigest:config.runtimeDigest});
 const stageDir=join(root,'preview',stageKey),outputPath=join(stageDir,'output','preview.mp4'),key=`${revisionPrefix}preview-excerpt/${profile}`;
 const inputHash=canonicalHash({projectId,revisionId,profile,stageKey,treatmentSha256:treatmentRef.sha256,timingDraftSha256:timingRecord.draftRef.sha256,compositeHash:canonicalHash(composite),segments});
 const intent=await createOrRead<ExcerptIntent>(projects.store,`${key}/intent`,{inputHash,artifactId:randomUUID()});
 if(intent.inputHash!==inputHash||!z.uuid().safeParse(intent.artifactId).success)throw Error('PREVIEW_STAGE_CONFLICT');
 const qa=options.qa||technicalVideoQa,stageArtifact=options.stageArtifact||stagePreviewArtifact;
 const expected={width,height,durationSec:durationMs/1000,fps,audio:true};
 async function verify(record:PreviewExcerptRecord){
  if(record.schemaVersion!==1||record.briefVersion!==control.briefVersion||record.treatmentSha256!==treatmentRef.sha256||record.timingDraftSha256!==timingRecord.draftRef.sha256||record.compositeHash!==canonicalHash(composite)||record.profile!==profile||canonicalHash(record.excerptMap)!==canonicalHash(segments)||record.stageKey!==stageKey||record.outputPath!==outputPath||record.sourceFilmSha256!==composite.technicalQa.sha256||record.durationMs!==durationMs||record.artifactId!==intent.artifactId||record.previewArtifactSha256!==record.technicalQa.sha256||record.qualityStatus!=='semantic_not_checked')throw Error('PREVIEW_STAGE_CONFLICT');
  const actual=await qa(stageDir,config.image,'output/preview.mp4',expected);
  if(canonicalHash(actual)!==canonicalHash(record.technicalQa))throw Error('PREVIEW_OUTPUT_CHANGED');
  const artifact=await stageArtifact(projects,dataRoot,projectId,revisionId,record.artifactId,{stageKey,outputPath,sha256:actual.sha256,bytes:actual.bytes,durationMs,sourceFilmSha256:composite.technicalQa.sha256,excerptMap:segments,technicalQa:actual},env);
  if(artifact.id!==record.artifactId||artifact.revisionId!==revisionId||artifact.objectRef.sha256!==actual.sha256||artifact.objectRef.bytes!==actual.bytes||artifact.objectRef.mime!=='video/mp4'||!artifact.qaPassed||!artifact.uploaded)throw Error('PREVIEW_ARTIFACT_MISMATCH');
  const latest=(await projects.store.readFresh<ProjectControl>(`${prefix}/control`)).value;
  assertPreviewProductionFence(latest,projectId,operationId,expectedConsentEpoch,{briefVersion:control.briefVersion,understandingRef:control.understandingRef});
  return record;
 }
 try{return await verify((await projects.store.readFresh<PreviewExcerptRecord>(key)).value)}catch(error){if(!(error instanceof StoreMissing))throw error}
 const rendered=await (options.render||renderPreviewExcerpt)({root,sourcePath:composite.outputPath,sourceSha256:composite.technicalQa.sha256,sourceDurationMs:timing.durationMs,segments,speechWindows,width,height,fps,env});
 if(rendered.stageKey!==stageKey||rendered.outputPath!==outputPath||rendered.sourceFilmSha256!==composite.technicalQa.sha256||rendered.durationMs!==durationMs||rendered.sha256!==rendered.technicalQa.sha256||rendered.bytes!==rendered.technicalQa.bytes||rendered.technicalQa.frames!==totalFrames||canonicalHash(rendered.excerptMap)!==canonicalHash(segments))throw Error('PREVIEW_OUTPUT_INVALID');
 const actual=await qa(stageDir,config.image,'output/preview.mp4',expected);
 if(canonicalHash(actual)!==canonicalHash(rendered.technicalQa))throw Error('PREVIEW_OUTPUT_CHANGED');
 const latest=(await projects.store.readFresh<ProjectControl>(`${prefix}/control`)).value;
 assertPreviewProductionFence(latest,projectId,operationId,expectedConsentEpoch,{briefVersion:control.briefVersion,understandingRef:control.understandingRef});
 const artifact=await stageArtifact(projects,root,projectId,revisionId,intent.artifactId,rendered,env);
 if(artifact.id!==intent.artifactId||artifact.revisionId!==revisionId||artifact.objectRef.sha256!==actual.sha256||artifact.objectRef.bytes!==actual.bytes||artifact.objectRef.mime!=='video/mp4'||!artifact.qaPassed||!artifact.uploaded)throw Error('PREVIEW_ARTIFACT_MISMATCH');
 const latestAfter=(await projects.store.readFresh<ProjectControl>(`${prefix}/control`)).value;
 assertPreviewProductionFence(latestAfter,projectId,operationId,expectedConsentEpoch,{briefVersion:control.briefVersion,understandingRef:control.understandingRef});
 const record:PreviewExcerptRecord={schemaVersion:1,briefVersion:control.briefVersion,treatmentSha256:treatmentRef.sha256,timingDraftSha256:timingRecord.draftRef.sha256,compositeHash:canonicalHash(composite),profile,excerptMap:segments,stageKey,outputPath,sourceFilmSha256:composite.technicalQa.sha256,durationMs,artifactId:intent.artifactId,previewArtifactSha256:actual.sha256,technicalQa:actual,qualityStatus:'semantic_not_checked'};
 const stored=await createOrRead(projects.store,key,record);
 if(canonicalHash(stored)!==canonicalHash(record))throw Error('PREVIEW_STAGE_CONFLICT');
 return verify(stored);
}
