import {expect,it} from 'vitest';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import type {CompositeStageRecord} from '@/services/video/preview/composite-stage';
import {prepareVisualReviewBatch} from '@/services/video/quality/visual-review-stage';
import {FileStore} from '@/services/video/storage/file-store';
import {ProjectStore} from '@/services/video/storage/project-store';
import {updateJson} from '@/services/video/storage/atomic-store';
import type {ProjectControl} from '@/contracts/video/project';
import type {FilmSpec} from '@/contracts/video/film';
import {seedPreviewBundle} from './fixtures/preview-package';
import type {VisualEvidence} from '@/services/video/quality/visual-evidence';
import type {VisualReview} from '@/contracts/video/visual-review';
import type {VisualReviewContext} from '@/contracts/video/visual-review';
import {loadVerifiedFilmPackage} from '@/contracts/video/film-package';
import {assertCompositePackageFields} from '@/services/video/quality/composite-binding';

it('archives a film-bound sampled review once, revalidates byte evidence on replay and fences cancellation before commit',async()=>{
 const root=await mkdtemp(join(tmpdir(),'vb-critic-stage-'));
 try{
  const projects=new ProjectStore(new FileStore(root)),created=await projects.create('owner',{schemaVersion:5,clientCommandId:randomUUID(),clientCreateId:randomUUID()}),{projectId}=created,revisionId=randomUUID(),operationId=randomUUID();
  const bundle=await seedPreviewBundle(projects,{projectId,revisionId,durationSec:20,briefVersion:1,previewArtifactSha256:'a'.repeat(64)}),spec=(await projects.store.readFresh<FilmSpec>(bundle.filmSpecRef.key)).value;
  await updateJson(projects.store,'projects/'+projectId+'/control',(c:ProjectControl):ProjectControl=>({...c,briefVersion:1,understandingRef:spec.understandingRef,phase:'preparing_preview',activeProduction:operationId}));
  const filmSha256='d'.repeat(64),sha='1'.repeat(64),movie:CompositeStageRecord={schemaVersion:4,briefVersion:1,treatmentSha256:(await projects.store.readFresh<{planRef:{sha256:string}}>(spec.treatmentRef.key)).value.planRef.sha256,audioPlanSha256:sha,audioExecutionSha256:null,timingDraftSha256:sha,pictureSequenceHash:sha,voiceVerifiedSha256:sha,narrationPackageSha256:sha,captionStyle:null,loudness:{status:'pass',filmSha256,runtimeDigest:sha,integratedLufs:-14,truePeakDbtp:-1.5,targetLufs:-14,toleranceLu:1,maxTruePeakDbtp:-1.2},postMix:{status:'not_applicable',reason:'no_narration',filmSha256,executionSha256:sha,voiceTrackSha256:sha,lines:[]},profile:'preview',stageKey:sha,outputPath:join(root,'composition',sha,'output/final.mp4'),technicalQa:{result:'pass',sha256:filmSha256,bytes:2000,width:1280,height:720,durationSec:20,fps:24,frames:480,audio:true},qualityStatus:'semantic_not_checked'};
  const frozen=await loadVerifiedFilmPackage(projects.store,spec,root);
  const bound={...movie,timingDraftSha256:frozen.audioManifest.timingDraftRef.sha256,audioPlanSha256:frozen.audioManifest.planRef.sha256,audioExecutionSha256:frozen.audioManifest.executionRef?.sha256||null};
  expect(()=>assertCompositePackageFields(bound,frozen)).not.toThrow();
  for(const field of ['timingDraftSha256','audioPlanSha256','audioExecutionSha256'] as const)expect(()=>assertCompositePackageFields({...bound,[field]:'0'.repeat(64)},frozen)).toThrow('CRITIC_COMPOSITE_BINDING_INVALID');
  await projects.store.create('projects/'+projectId+'/revisions/'+revisionId+'/composite-v4/preview',movie);
  const png=await readFile('docs/engineering/evidence/native-frame-3.png'),pngHash=createHash('sha256').update(png).digest('hex');let changed=false,calls=0,cancel=false;
  const evidence:VisualEvidence={schemaVersion:2,extractor:'ffmpeg-select-v2',stageKey:'e'.repeat(64),filmSha256,runtimeDigest:sha,width:1280,height:720,frames:[{id:'frame-324',frame:324,sha256:pngHash,bytes:png.length,filename:'frame-0001.png'}]};
  // Inject producer verification only here: this test covers archival and fences, not media provenance.
  const options={root,verifyComposite:async()=>movie,env:{VIDEO_MEDIA_IMAGE_REF:'sha256:'+sha,VIDEO_MEDIA_RUNTIME_DIGEST:sha,VIDEO_MEDIA_TIMEOUT_SECONDS:'120'},qa:async()=>({...movie.technicalQa,result:'pass' as const}),extract:async()=>evidence,readImages:async()=>{if(changed)throw Error('VISUAL_EVIDENCE_CHANGED');return new Map([['frame-324',png]])}};
  const decide=async(context:VisualReviewContext):Promise<VisualReview>=>{
   calls++;if(cancel)await updateJson(projects.store,'projects/'+projectId+'/control',(c:ProjectControl)=>({...c,consentEpoch:c.consentEpoch+1}));
   return{schemaVersion:1,filmSha256:context.filmSha256,filmSpecSha256:context.filmSpecSha256,frameSetSha256:context.frameSetSha256,styleSlug:context.styleSlug,styleRulesHash:context.styleRulesHash,round:context.round,scope:'sampled_frames',observations:[{frameId:'frame-324',visibleText:['上海青禾社'],issues:[]}],facts:context.facts.map(fact=>({factId:fact.id,result:'not_checked',frameIds:[],reason:'所示帧没有该文字'})),style:{result:'not_checked',frameIds:[],reason:'未完成风格检查'},readability:{result:'not_checked',frameIds:[],reason:'单帧不能判断阅读时间'}};
  };
  const invoke=(round:1|2=1)=>prepareVisualReviewBatch(projects,projectId,revisionId,operationId,0,bundle.filmSpecRef,'preview',[324],round,{...options,decide});
  const first=await invoke();expect(first.qualityStatus).toBe('sampled_visuals_only');expect(calls).toBe(1);expect(await invoke()).toEqual(first);expect(calls).toBe(1);
  changed=true;await expect(invoke()).rejects.toThrow('VISUAL_EVIDENCE_CHANGED');changed=false;
  cancel=true;await expect(invoke(2)).rejects.toThrow('PREVIEW_STALE');expect(calls).toBe(2);
 }finally{await rm(root,{recursive:true,force:true})}
});
