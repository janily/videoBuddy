import type {Understanding} from '@/contracts/video/domain';
import {guardTreatment} from '@/contracts/video/treatment';
import type {NarrationPlan} from '@/services/video/audio/narration';
import {getStyle} from '@/services/video/styles/registry';

export function compileVoicePlan(rawPlan:unknown, understanding:Understanding):NarrationPlan {
 if (!understanding.preferences.styleSlug) throw Error('TREATMENT_BASELINE_CHANGED');
 const style=getStyle(understanding.preferences.styleSlug);
 const plan=guardTreatment(rawPlan,understanding,style.rulesHash);
 const durationMs=plan.durationSec*1000;
 if (understanding.preferences.voiceMode==='user_recording') throw Error('VOICE_RECORDING_NOT_READY');
 if (understanding.preferences.voiceMode==='none') return {durationMs,lines:[]};
 const lines=plan.shots.map((shot,index)=>{
  const text=shot.scriptLine,startMs=Math.round(shot.startFrame*1000/plan.fps),endMs=Math.round(shot.endFrame*1000/plan.fps);
  if (!text.trim()||text.length>250||/[\u0000-\u001f\u007f]/.test(text)) throw Error('VOICE_LINE_TOO_LONG');
  if (endMs<=startMs||endMs>durationMs) throw Error('VOICE_WINDOW_INVALID');
  return {lineId:`line_${index+1}`,language:understanding.preferences.language,spokenText:text,displayText:text,expectedAsrText:text,startMs,reservedMs:endMs-startMs};
 });
 return {durationMs,lines};
}
