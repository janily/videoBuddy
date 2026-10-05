import {assertMvpProfile} from '@/services/video/quality/delivery';
import {readFrozenPreview} from './frozen-preview';
import {UnderstandingSchema} from '@/contracts/video/domain';
import {guardTreatment} from '@/contracts/video/treatment';
import {loadVerifiedFilmPackage} from '@/contracts/video/film-package';
import type {ProjectStore} from '@/services/video/storage/project-store';
import type {Environment} from '@/services/video/config/environment';
import {getStyle} from '@/services/video/styles/registry';
import {readNarrationJson} from '@/services/video/audio/narration-package';
import {prepareVisualReviewBatch} from '@/services/video/quality/visual-review-stage';
import {prepareTreatmentStage} from './treatment-stage';
import {prepareContentRequirementsStage} from './content-requirements-stage';
import {prepareVoiceStage} from './voice-stage';
import {prepareTimingStage} from './timing-stage';
import {prepareNarrationPackageStage} from './narration-package-stage';
import {prepareAudioPlanStage} from './audio-plan-stage';
import {prepareAudioExecutionStage} from './audio-execution-stage';
import {prepareVisualShotStage} from './visual-stage';
import {preparePictureShotStage} from './picture-stage';
import {preparePictureSequenceStage} from './picture-sequence-stage';
import {prepareFilmPackageStage} from './film-package-stage';
import {prepareCompositeStage} from './composite-stage';
import {preparePreviewExcerptStage} from './excerpt-stage';
import {selectPreviewExcerpt} from './select-excerpt';
import {publishPreparedPreview} from './publish';
import {assertPreviewOperation} from './operation';
import {assertPreviewProductionFence} from './fence';
import type {ProjectControl} from '@/contracts/video/project';
import {guardVisualReview,assertPreviewReviewEligible,type VisualReviewContext} from '@/contracts/video/visual-review';
import {dockerConfiguration} from '@/services/video/media/docker-executor';
import {voiceConfiguration} from '@/services/video/audio/voice';
import {asrConfiguration} from '@/services/video/audio/asr';
import {configuredModel} from '@/mastra/video/model-adapter';

export async function buildPreviewPipeline(projects:ProjectStore,input:Parameters<typeof publishPreparedPreview>[1],options:{root:string;env?:Environment},activity:(stage:string,label:string)=>Promise<void>){
 const {projectId,revisionId,operationId,expectedConsentEpoch}=input,{root}=options,env=options.env||process.env,prefix=`projects/${projectId}`,revisionPrefix=`${prefix}/revisions/${revisionId}/`;
 // Pure configuration checks precede every paid creation request.
 dockerConfiguration(env,operationId);
 for(const role of ['director','visual','audio','critic'] as const)configuredModel(role,env);
 const baseline=(await projects.store.readFresh<ProjectControl>(prefix+'/control')).value;
 const understanding=UnderstandingSchema.parse(await readNarrationJson(projects.store,baseline.understandingRef,prefix+'/understanding/'));
 if(env.VIDEO_DELIVERY_PROFILE&& !['mvp','full'].includes(env.VIDEO_DELIVERY_PROFILE))throw Error('CONFIGURATION_REQUIRED: VIDEO_DELIVERY_PROFILE');

 if(understanding.preferences.voiceMode!=='none'){voiceConfiguration(env);asrConfiguration(env)}
 async function stage(name:string,label:string){
  const c=(await projects.store.readFresh<ProjectControl>(prefix+'/control')).value;
  assertPreviewProductionFence(c,projectId,operationId,expectedConsentEpoch,{briefVersion:baseline.briefVersion,understandingRef:baseline.understandingRef});
  await assertPreviewOperation(projects,c,operationId,revisionId,input.previewId,expectedConsentEpoch);await activity(name,label);
 }
 const retry=await readFrozenPreview(projects,root,projectId,operationId,revisionId,expectedConsentEpoch),mustExist=Boolean(retry);
 if(!retry&&env.VIDEO_DELIVERY_PROFILE==='mvp')assertMvpProfile(understanding);
 if(!retry){await stage('source','正在核对资料的表达要求');await prepareContentRequirementsStage(projects,projectId,revisionId,operationId,expectedConsentEpoch,{env})}
 await stage('treatment','正在构思故事');
 const treatmentRef=retry?.treatmentRef||await prepareTreatmentStage(projects,projectId,revisionId,operationId,expectedConsentEpoch,{env});
 const treatment=guardTreatment(await readNarrationJson(projects.store,treatmentRef,revisionPrefix+'treatment-plan/'),understanding,getStyle(understanding.preferences.styleSlug!).rulesHash);
 const args=[projects,projectId,revisionId,operationId,expectedConsentEpoch,treatmentRef] as const;
 await stage('voice','正在制作和核验声音');await prepareVoiceStage(...args,{root,env,mustExist});
 await stage('timing','正在安排画面和字幕');await prepareTimingStage(...args,{root,env,mustExist});await prepareNarrationPackageStage(...args,{root,env,mustExist});
 await stage('audio','正在编排音乐和音效');await prepareAudioPlanStage(...args,{root,env,mustExist});await prepareAudioExecutionStage(...args,{root,env,mustExist});
 for(const [index,shot] of treatment.shots.entries()){
  await stage('visual',`正在创作第 ${index+1} 段画面`);await prepareVisualShotStage(...args,shot.id,{root,env,mustExist});
  await stage('picture',`正在生成第 ${index+1} 段画面`);await preparePictureShotStage(...args,shot.id,{root,env,profile:'preview',mustExist});
 }
 await stage('composition','正在合成画面和声音');await preparePictureSequenceStage(...args,{root,env,profile:'preview',mustExist});
 const film=await prepareFilmPackageStage(...args,{root,env,mustExist});await prepareCompositeStage(...args,{root,env,profile:'preview',frozenFilm:retry?.film});
 const frozen=await loadVerifiedFilmPackage(projects.store,await readNarrationJson(projects.store,film.filmSpecRef,revisionPrefix+'film/'),root);
 const segments=selectPreviewExcerpt(frozen.timeline,frozen.facts.facts.filter(f=>f.critical||f.mustInclude).map(f=>f.id));
 await stage('excerpt','正在准备效果片段');await preparePreviewExcerptStage(...args,segments,{root,env});
 // Preview samples are evidence; complete two-round film QA belongs to delivery.
 const frames=[...new Set(segments.map(s=>Math.floor((s.sourceStartMs!+s.sourceEndMs!)*frozen.timeline.fps/2000)))].sort((a,b)=>a-b),reviewBatches=[{frames,round:1 as const}];
 await stage('critic','正在检查效果画面');const review=await prepareVisualReviewBatch(projects,projectId,revisionId,operationId,expectedConsentEpoch,film.filmSpecRef,'preview',frames,1,{root,env});
 const context=await readNarrationJson(projects.store,review.contextRef,revisionPrefix+'visual-review-context/') as VisualReviewContext;
 assertPreviewReviewEligible(guardVisualReview(await readNarrationJson(projects.store,review.reviewRef,revisionPrefix+'visual-review/'),context));
 await stage('publication','正在保存效果片段');return publishPreparedPreview(projects,input,{root,env,reviewBatches});
}
