import {randomUUID} from 'node:crypto';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import type {ProjectControl} from '../../src/contracts/video/project';
import {initialUnderstanding} from '../../src/contracts/video/domain';
import {updateJson} from '../../src/services/video/storage/atomic-store';
import {FileStore} from '../../src/services/video/storage/file-store';
import {ProjectStore} from '../../src/services/video/storage/project-store';
import {getStyle} from '../../src/services/video/styles/registry';
import {prepareVoiceStage} from '../../src/services/video/preview/voice-stage';

async function main(){
 const root=await mkdtemp(join(tmpdir(),'vb-voice-stage-probe-'));
 try{
  const projects=new ProjectStore(new FileStore(root)),{projectId}=await projects.create('probe-owner',{schemaVersion:5,clientCommandId:randomUUID(),clientCreateId:randomUUID()});
  const revisionId=randomUUID(),operationId=randomUUID(),messageId=randomUUID(),style=getStyle('crayon-book'),base=initialUnderstanding(),line='上海的活动将在十月八日开始。';
  const fact={id:'event-date',text:'活动十月八日开始',sourceRefs:[{type:'user_message' as const,id:messageId}],status:'confirmed' as const,mustInclude:true,critical:true};
  const understanding={...base,briefVersion:1,subject:'活动预告',sourceMessageIds:[messageId],facts:[fact],preferences:{...base.preferences,durationSec:20,styleSlug:style.slug,voiceMode:'tts' as const}};
  const understandingRef=await projects.index.immutable(`projects/${projectId}/understanding/1`,understanding);
  await updateJson(projects.store,`projects/${projectId}/control`,(control:ProjectControl)=>({...control,briefVersion:1,understandingRef,phase:'preparing_preview' as const,activeProduction:operationId}));
  const plan={schemaVersion:1,briefVersion:1,styleSlug:style.slug,styleRulesHash:style.rulesHash,durationSec:20,aspect:'16:9',fps:24,summary:'活动预告',options:[
   {id:'a',concept:'绘制会场',visualApproach:'蜡笔逐层成形',soundApproach:'轻快打击乐',tradeoff:'动画量多'},
   {id:'b',concept:'角色带路',visualApproach:'跟随人物',soundApproach:'脚步声',tradeoff:'动作成本高'},
   {id:'c',concept:'纸页传递信息',visualApproach:'翻页文字',soundApproach:'纸张拟音',tradeoff:'人物较少'},
  ],selectedOptionId:'a',selectionReason:'日期清晰',shots:[{id:'shot',startFrame:0,endFrame:480,visualIntent:'呈现活动日期',scriptLine:line,factIds:['event-date']}],script:[line]};
  const treatmentRef=await projects.index.immutable(`projects/${projectId}/revisions/${revisionId}/treatment-plan`,plan);
  const first=await prepareVoiceStage(projects,projectId,revisionId,operationId,0,treatmentRef,{root}),replay=await prepareVoiceStage(projects,projectId,revisionId,operationId,0,treatmentRef,{root});
  if(first.verifiedRef.sha256!==replay.verifiedRef.sha256)throw Error('VOICE_STAGE_REPLAY_CHANGED');
  const verified=(await projects.store.readFresh<{lines:Array<{asrStatus:string;asr:{runtimeDigest:string};wordTimings:Array<unknown>;voice:{wav:{sha256:string;durationMs:number};runtimeDigest:string}}> }>(first.verifiedRef.key)).value;
  if(verified.lines.length!==1||verified.lines[0].asrStatus!=='pass'||verified.lines[0].wordTimings.length===0)throw Error('VOICE_STAGE_PROBE_FAILED');
  const evidence={technicalProbeOnly:true,styleSlug:style.slug,briefVersion:1,voiceRuntimeDigest:verified.lines[0].voice.runtimeDigest,asrRuntimeDigest:verified.lines[0].asr.runtimeDigest,voiceSha256:verified.lines[0].voice.wav.sha256,voiceDurationMs:verified.lines[0].voice.wav.durationMs,wordCount:verified.lines[0].wordTimings.length,asrStatus:verified.lines[0].asrStatus,immutablePlanSha256:first.planRef.sha256,immutableVerifiedSha256:first.verifiedRef.sha256,replayIdentical:true,limits:'One synthetic 20-second project brief and one real offline TTS/ASR line; no visual preview, full mix, listening review or user footage.'};
  if(process.argv.includes('--record'))await writeFile('docs/engineering/evidence/voice-stage-probe.json',JSON.stringify(evidence,null,2)+'\n');
  process.stdout.write(JSON.stringify(evidence)+'\n');
 }finally{await rm(root,{recursive:true,force:true})}
}
main().catch(error=>{console.error(error instanceof Error?error.message:'VOICE_STAGE_PROBE_FAILED');process.exitCode=1});
