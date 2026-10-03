import {isAbsolute} from 'node:path';
import {z} from 'zod';
import {ObjectRefSchema,type ObjectRef} from '@/contracts/video/domain';
import {FilmTimelineSchema} from '@/contracts/video/film';
import type {ProjectControl} from '@/contracts/video/project';
import type {VerifiedNarrationManifest} from '@/services/video/audio/asr';
import {archiveVerifiedNarration,loadPackagedNarration,readNarrationJson} from '@/services/video/audio/narration-package';
import type {Environment} from '@/services/video/config/environment';
import {canonicalHash} from '@/services/video/domain/hash';
import {createOrRead,StoreMissing} from '@/services/video/storage/atomic-store';
import type {ProjectStore} from '@/services/video/storage/project-store';
import {assertPreviewProductionFence} from './fence';
import {TimingDraftSchema} from './timing-draft';
import {prepareTimingStage} from './timing-stage';
import {prepareVoiceStage} from './voice-stage';

const digest=z.string().regex(/^[a-f0-9]{64}$/);
export const NarrationPackageDataSchema=z.strictObject({schemaVersion:z.literal(1),briefVersion:z.number().int().nonnegative(),treatmentSha256:digest,timingDraftSha256:digest,voiceVerifiedSha256:digest,
 lines:FilmTimelineSchema.shape.narration,
 sources:z.array(z.strictObject({id:z.string().min(1),kind:z.literal('generated'),sourceRef:ObjectRefSchema,rightsRef:ObjectRefSchema})),qualityStatus:z.literal('semantic_not_checked')});
const RecordSchema=z.strictObject({schemaVersion:z.literal(1),briefVersion:z.number().int().nonnegative(),understandingSha256:digest,treatmentSha256:digest,timingDraftSha256:digest,voiceVerifiedSha256:digest,packageRef:ObjectRefSchema});
export type NarrationPackageStageRecord=z.infer<typeof RecordSchema>;
interface Options{root?:string;env?:Environment;mustExist?:boolean}

export async function prepareNarrationPackageStage(projects:ProjectStore,projectId:string,revisionId:string,operationId:string,expectedConsentEpoch:number,treatmentRef:ObjectRef,options:Options={}):Promise<NarrationPackageStageRecord>{
 if(![projectId,revisionId,operationId].every(id=>z.uuid().safeParse(id).success)||!Number.isSafeInteger(expectedConsentEpoch)||expectedConsentEpoch<0)throw Error('VALIDATION_FAILED');
 const env=options.env||process.env,root=options.root||env.VIDEO_DATA_DIR;
 if(!root||!isAbsolute(root))throw Error('CONFIGURATION_REQUIRED: VIDEO_DATA_DIR');
 const prefix=`projects/${projectId}`,revisionPrefix=`${prefix}/revisions/${revisionId}/`,control=(await projects.store.readFresh<ProjectControl>(`${prefix}/control`)).value;
 assertPreviewProductionFence(control,projectId,operationId,expectedConsentEpoch);
 const voice=await prepareVoiceStage(projects,projectId,revisionId,operationId,expectedConsentEpoch,treatmentRef,{root,env,mustExist:true});
 const timing=await prepareTimingStage(projects,projectId,revisionId,operationId,expectedConsentEpoch,treatmentRef,{root,env,mustExist:true});
 const verified=await readNarrationJson(projects.store,voice.verifiedRef,revisionPrefix) as VerifiedNarrationManifest;
 const draft=TimingDraftSchema.parse(await readNarrationJson(projects.store,timing.draftRef,revisionPrefix));
 const baseline={schemaVersion:1 as const,briefVersion:control.briefVersion,understandingSha256:control.understandingRef.sha256,treatmentSha256:treatmentRef.sha256,timingDraftSha256:timing.draftRef.sha256,voiceVerifiedSha256:voice.verifiedRef.sha256};
 const key=`${revisionPrefix}narration-package-stage`;
 async function verify(untrusted:unknown){
  const parsed=RecordSchema.safeParse(untrusted);if(!parsed.success)throw Error('NARRATION_PACKAGE_CONFLICT');
  const record=parsed.data,{packageRef,...storedBaseline}=record;
  if(canonicalHash(storedBaseline)!==canonicalHash(baseline))throw Error('NARRATION_PACKAGE_CONFLICT');
  const data=NarrationPackageDataSchema.parse(await readNarrationJson(projects.store,packageRef,`${revisionPrefix}narration-package/`));
  if(data.briefVersion!==baseline.briefVersion||data.treatmentSha256!==baseline.treatmentSha256||data.timingDraftSha256!==baseline.timingDraftSha256||data.voiceVerifiedSha256!==baseline.voiceVerifiedSha256||data.lines.length!==verified.lines.length||data.sources.length!==data.lines.length)throw Error('NARRATION_PACKAGE_CONFLICT');
  for(const [index,line] of verified.lines.entries()){
   const entry=data.sources[index],packaged=await loadPackagedNarration(projects.store,root!,projectId,revisionId,entry.sourceRef),actual=packaged.timelineLine,expected=draft.narration[index];
   const config={language:line.language,voice:line.voice.voice,provider:line.voice.provider,model:line.voice.model,modelLicense:line.voice.modelLicense,runtimeDigest:line.voice.runtimeDigest};
   if(entry.id!==`voice-${line.lineId}`||canonicalHash(data.lines[index])!==canonicalHash(actual)||actual.lineId!==expected.lineId||actual.startSample!==expected.startSample||actual.endSample!==expected.endSample||actual.displayText!==expected.displayText||actual.spokenText!==expected.spokenText||actual.expectedAsrText!==expected.expectedAsrText||actual.voiceConfigHash!==canonicalHash(config)||canonicalHash(packaged.source.wav)!==canonicalHash(line.voice.wav)||canonicalHash(packaged.words.words)!==canonicalHash(line.wordTimings)||packaged.words.recognizedText!==line.recognizedText||packaged.words.asrRuntimeDigest!==line.asr.runtimeDigest||packaged.words.asrModel!==line.asr.model)throw Error('NARRATION_PACKAGE_CONFLICT');
   const rights=await readNarrationJson(projects.store,entry.rightsRef,`${revisionPrefix}narration-rights/`);
   if(canonicalHash(rights)!==canonicalHash({basis:'generated',source:`${config.provider}; ${config.model}; voice=${config.voice}; modelLicense=${config.modelLicense}; runtime=${config.runtimeDigest}`}))throw Error('NARRATION_PACKAGE_CONFLICT');
  }
  const latest=(await projects.store.readFresh<ProjectControl>(`${prefix}/control`)).value;
  assertPreviewProductionFence(latest,projectId,operationId,expectedConsentEpoch,{briefVersion:control.briefVersion,understandingRef:control.understandingRef});
  return record;
 }
 try{return await verify((await projects.store.readFresh<unknown>(key)).value)}catch(error){if(!(error instanceof StoreMissing))throw error}
 if(options.mustExist)throw Error('NARRATION_PACKAGE_MISSING');
 const archived=await archiveVerifiedNarration(projects,root,projectId,revisionId,verified,draft.narration);
 const data=NarrationPackageDataSchema.parse({schemaVersion:1,briefVersion:baseline.briefVersion,treatmentSha256:baseline.treatmentSha256,timingDraftSha256:baseline.timingDraftSha256,voiceVerifiedSha256:baseline.voiceVerifiedSha256,...archived,qualityStatus:'semantic_not_checked'});
 const latest=(await projects.store.readFresh<ProjectControl>(`${prefix}/control`)).value;
 assertPreviewProductionFence(latest,projectId,operationId,expectedConsentEpoch,{briefVersion:control.briefVersion,understandingRef:control.understandingRef});
 const record={...baseline,packageRef:await projects.index.immutable(`${revisionPrefix}narration-package`,data)};
 const stored=await createOrRead(projects.store,key,record);
 if(canonicalHash(stored)!==canonicalHash(record))throw Error('NARRATION_PACKAGE_CONFLICT');
 return verify(stored);
}
