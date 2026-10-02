import {expect,it} from 'vitest';
import {initialUnderstanding} from '@/contracts/video/domain';
import {getStyle} from '@/services/video/styles/registry';
import {compileVoicePlan} from '@/services/video/preview/voice-plan';

const style=getStyle('crayon-book');
const base=initialUnderstanding();
const understanding={...base,briefVersion:1,subject:'活动预告',preferences:{...base.preferences,styleSlug:style.slug,durationSec:20,voiceMode:'tts' as const}};
const shots=[{id:'a',startFrame:0,endFrame:240,visualIntent:'开场',scriptLine:'十月八日见。',factIds:[]},{id:'b',startFrame:240,endFrame:480,visualIntent:'结尾',scriptLine:'欢迎参加。',factIds:[]}];
const plan={schemaVersion:1,briefVersion:1,styleSlug:style.slug,styleRulesHash:style.rulesHash,durationSec:20,aspect:'16:9',fps:24,summary:'活动预告',options:[{id:'a',concept:'绘图',visualApproach:'蜡笔',soundApproach:'鼓点',tradeoff:'动画多'},{id:'b',concept:'纸页',visualApproach:'翻页',soundApproach:'纸声',tradeoff:'人物少'},{id:'c',concept:'角色',visualApproach:'走路',soundApproach:'脚步',tradeoff:'造型复杂'}],selectedOptionId:'a',selectionReason:'信息清晰',shots,script:shots.map(shot=>shot.scriptLine)};

it('T10 derives exact voice windows and immutable ASR expectations from the approved treatment',()=>{
 const result=compileVoicePlan(plan,understanding);
 expect(result).toEqual({durationMs:20000,lines:[
  {lineId:'line_1',language:'zh-CN',spokenText:'十月八日见。',displayText:'十月八日见。',expectedAsrText:'十月八日见。',startMs:0,reservedMs:10000},
  {lineId:'line_2',language:'zh-CN',spokenText:'欢迎参加。',displayText:'欢迎参加。',expectedAsrText:'欢迎参加。',startMs:10000,reservedMs:10000},
 ]});
 expect(compileVoicePlan(plan,{...understanding,preferences:{...understanding.preferences,voiceMode:'none'}}).lines).toEqual([]);
 expect(()=>compileVoicePlan(plan,{...understanding,preferences:{...understanding.preferences,voiceMode:'user_recording'}})).toThrow('VOICE_RECORDING_NOT_READY');
 expect(()=>compileVoicePlan({...plan,shots:[{...shots[0],scriptLine:'欢迎'.repeat(126)},shots[1]],script:['欢迎'.repeat(126),shots[1].scriptLine]},understanding)).toThrow('VOICE_LINE_TOO_LONG');
 expect(()=>compileVoicePlan({...plan,shots:[{...shots[0],scriptLine:'其他'},shots[1]]},understanding)).toThrow('TREATMENT_SCRIPT_INVALID');
});
