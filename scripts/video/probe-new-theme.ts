import {randomUUID} from 'node:crypto';
import {mkdir,mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {FileStore} from '../../src/services/video/storage/file-store';
import {ProjectStore} from '../../src/services/video/storage/project-store';
import {LocalOperationQueue} from '../../src/services/video/commands/local-queue';
import {LocalEventLog} from '../../src/services/video/stream/local-event-log';
import {runPreviewOperation} from '../../src/services/video/commands/local-preview';
import {runEffect} from '../../src/services/video/commands/effect-ledger';
import {updateJson} from '../../src/services/video/storage/atomic-store';
import {runDirectorStream,applyUnderstandingPatch} from '../../src/mastra/video/director';
import {initialUnderstanding} from '../../src/contracts/video/domain';
import type {ProjectControl} from '../../src/contracts/video/project';
import {authorizeUnlimitedValidation} from '../../src/services/video/budget/validation-authorization';
import {reserveModelBudget,modelLimits} from '../../src/services/video/budget/model-budget';
import {withAccountedModel} from '../../src/services/video/budget/model-call';
import {preparePreview,type PreviewOperation} from '../../src/services/video/preview/prepare';
import {buildPreviewPipeline} from '../../src/services/video/preview/pipeline';
import {probeEnvironment,recordModelRequests} from './helpers/real-probe';
import type {Environment} from '../../src/services/video/config/environment';

// New acceptance scenario, not a reset/retry of the historical unknown film.
async function main(){
 if(!process.argv.includes('--new-theme'))throw Error('NEW_THEME_OPT_IN_REQUIRED');
 const parent=resolve('.video-local/new-theme');await mkdir(parent,{recursive:true,mode:0o700});const root=await mkdtemp(join(parent,'seed-'));
 const env:Environment={...probeEnvironment(root),VIDEO_MODEL_BUDGET_MODE:'unlimited_validation',VIDEO_MEDIA_TIMEOUT_SECONDS:'600'};
 const store=new FileStore(root),projects=new ProjectStore(store),owner='new-theme-validation',authorization=JSON.parse(await readFile('docs/engineering/evidence/model-validation-authorization.json','utf8'));
 await authorizeUnlimitedValidation(store,authorization);
 const {projectId}=await projects.create(owner,{schemaVersion:5,clientCommandId:randomUUID(),clientCreateId:randomUUID()}),messageId=randomUUID();
 const text='独立的新主题验收场景：给小学生做一支20秒16:9横屏中文科普视频，采用蜡笔儿童绘本风格（crayon-book），主题是一粒种子长成绿芽。表达从播种、适量浇水到发芽的过程，以“观察成长，耐心照料”结束；不要承诺具体生长天数，不要虚构名称、活动日期或数字。需要中文合成旁白、自动字幕和原创轻柔配乐，没有外部素材。先生成真实效果预览，不能代替用户批准正式制作。';
 await projects.archiveMessage(projectId,{id:messageId,ordinal:1,role:'user',text,status:'completed',contentVersion:1,clientMessageId:messageId});
 const recorder=recordModelRequests(env,root,64,{timeoutMs:600000});
 const evidence:{executedAt:string;root:string;projectId:string;model:string|undefined;requests:typeof recorder.requests;stages:Record<string,unknown>;status:string;errorCode?:string;limits:string}={executedAt:new Date().toISOString(),root,projectId,model:env.VIDEO_DIRECTOR_MODEL,requests:recorder.requests,stages:{},status:'running',limits:'Independent new-theme acceptance scenario with actual provider and durable production preview pipeline. Unlimited validation authorization persisted; this individual diagnostic allows at most 64 requests, no automatic retries. All unknown effects remain blocked. No formal approval, delivery or 43-style acceptance claim; historical original name/readability/unknown-call failures are unchanged.'};
 const reportPath=join(root,'new-theme-evidence.json');
 async function record(){await recorder.flush();if(recorder.requests.length)evidence.stages.modelBudget=(await store.readFresh(`projects/${projectId}/budget`)).value;const body=JSON.stringify(evidence,null,2)+'\n';await writeFile(reportPath,body,{mode:0o600});await writeFile('docs/engineering/evidence/new-theme-probe.json',body)}
 try{
  await record();const r=(await reserveModelBudget(store,projectId,'new-theme-director',{inputTokens:60000,outputTokens:8000},modelLimits(env))).reservation;
  const decision=await runEffect(store,`projects/${projectId}/diagnostics/director`,()=>withAccountedModel(store,r,()=>runDirectorStream(initialUnderstanding(),[{id:messageId,role:'user',text}],8000,async()=>{},env)));
  evidence.stages.director=decision;await record();
  if(!decision.understandingPatch)throw Error('NEW_THEME_UNDERSTANDING_REQUIRED');
  const understanding=applyUnderstandingPatch(initialUnderstanding(),decision.understandingPatch,[{id:messageId,role:'user',text}]);
  if(understanding.subject!==''&&understanding.preferences.voiceMode==='tts'&&understanding.preferences.styleSlug==='crayon-book'&&understanding.preferences.durationSec===20&&understanding.preferences.aspect==='16:9'){
   const understandingRef=await projects.index.immutable(`projects/${projectId}/understanding/${understanding.briefVersion}`,understanding);
   await updateJson(store,`projects/${projectId}/control`,(c:ProjectControl)=>({...c,controlVersion:c.controlVersion+1,briefVersion:understanding.briefVersion,understandingRef}));
  }else throw Error('NEW_THEME_INTENT_CHANGED');
  const queue=new LocalOperationQueue(store,root),receipt=await preparePreview(projects,queue,owner,projectId,{schemaVersion:5,clientCommandId:randomUUID(),expectedBriefVersion:understanding.briefVersion,sourceMessageId:messageId});
  evidence.stages.previewReceipt=receipt;await record();
  await runPreviewOperation(store,new LocalEventLog(root),projectId,receipt.operationId,{root,env,build:async(...args)=>{
   const notify=args[3];return buildPreviewPipeline(args[0],args[1],args[2],async(stage,label)=>{await notify(stage,label);evidence.stages.currentStage=stage;await record();console.log(JSON.stringify({stage,status:'running',requests:recorder.requests.length}))});
  }});
  const operation=(await store.readFresh<PreviewOperation&{errorCode?:string}>(`projects/${projectId}/operations/${receipt.operationId}`)).value;
  evidence.stages.operation=operation;evidence.stages.control=(await store.readFresh<ProjectControl>(`projects/${projectId}/control`)).value;
  evidence.status=operation.status==='succeeded'?'pass':'blocked';if(evidence.status!=='pass'){evidence.errorCode=operation.errorCode||'PREVIEW_NOT_SUCCEEDED';process.exitCode=1}
 }catch(error){evidence.status='blocked';evidence.errorCode=String(error instanceof Error?error.message:'NEW_THEME_FAILED').replaceAll(env.MODEL_API_KEY||'missing-key','[redacted]').slice(0,300);process.exitCode=1}
 finally{await recorder.flush();recorder.restore();await record();console.log(JSON.stringify({status:evidence.status,root,projectId,requests:recorder.requests.length,errorCode:evidence.errorCode,currentStage:evidence.stages.currentStage}))}
}
main().catch(error=>{console.error(JSON.stringify({status:'fail',errorCode:String(error?.message||'NEW_THEME_FAILED').replaceAll(process.env.MODEL_API_KEY||'missing-key','[redacted]').slice(0,300)}));process.exitCode=1});
