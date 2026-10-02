import type {Understanding} from '@/contracts/video/domain';
import {guardTreatment} from '@/contracts/video/treatment';
import {guardVisualShot,VisualShotSourceSchema,type VisualShotSource} from '@/contracts/video/visual-shot';
import {TimingDraftSchema,type TimingDraft} from '@/services/video/preview/timing-draft';
import type {Environment} from '@/services/video/config/environment';
import {canonicalHash} from '@/services/video/domain/hash';
import {loadStageKnowledge} from '@/services/video/styles/knowledge-loader';
import {getStyle} from '@/services/video/styles/registry';
import {createVideoAgent} from './model-adapter';

const instructions=`你是 VideoBuddy Visual Agent，只创作当前镜头的原生画面源码，不修改事实、时长、镜头表、声音或用户批准状态。严格遵守当前已选风格的材料、构图、运动与字体规则；不要套用其他风格或复制示例主题。输出完整自包含 HTML，用逻辑画幅布局，设 window.READY=true 与 window.render(t)；t 是全片绝对秒，任意顺序调用都必须产生同一帧。动画只依赖 t、给定种子和固定资源，不使用计时器、requestAnimationFrame、当前时间或未种子的随机数。不得访问网络、浏览器存储、密钥或外部脚本。只能声明已授权 assetId 和当前镜头 factId；不得把模型代码当成质量检查结果。只输出严格 VisualShotSource 对象。`;

export async function runVisualShot(understanding:Understanding,rawTreatment:unknown,rawTiming:TimingDraft,expectedTimingHash:string,shotId:string,maxOutputTokens=12000,env:Environment=process.env):Promise<VisualShotSource>{
 if(!Number.isSafeInteger(maxOutputTokens)||maxOutputTokens<2000||maxOutputTokens>24000||!understanding.preferences.styleSlug)throw Error('VISUAL_INPUT_INVALID');
 const style=getStyle(understanding.preferences.styleSlug),knowledge=await loadStageKnowledge(style.slug,'style');
 const treatment=guardTreatment(rawTreatment,understanding,knowledge.sha256),timing=TimingDraftSchema.parse(rawTiming);
 if(canonicalHash(timing)!==expectedTimingHash)throw Error('VISUAL_BASELINE_CHANGED');
 const shot=treatment.shots.find(item=>item.id===shotId);if(!shot)throw Error('VISUAL_BASELINE_CHANGED');
 const context=JSON.stringify({understanding,treatment:{summary:treatment.summary,selectedOptionId:treatment.selectedOptionId,selectionReason:treatment.selectionReason,shots:treatment.shots,script:treatment.script},timingDraftHash:expectedTimingHash,timing:{...timing,track:{sha256:timing.track.sha256,samples:timing.track.samples,silence:timing.track.silence}},currentShot:shot,style:{slug:style.slug,packVersion:style.packVersion,rulesHash:knowledge.sha256,rules:knowledge.rules},requirements:{logicalSize:understanding.preferences.aspect==='16:9'?[1920,1080]:[1080,1920],absoluteTime:true,offline:true}});
 if(Buffer.byteLength(context)>180000)throw Error('CONTEXT_LIMIT');
 const agent=createVideoAgent('visual',instructions,env);
 const response=await agent.generate(context,{structuredOutput:{schema:VisualShotSourceSchema,jsonPromptInjection:env.MODEL_PROVIDER==='openai-compatible',errorStrategy:'strict'},maxSteps:1,modelSettings:{maxOutputTokens,maxRetries:0}});
 return guardVisualShot(response.object,understanding,treatment,timing,expectedTimingHash);
}
