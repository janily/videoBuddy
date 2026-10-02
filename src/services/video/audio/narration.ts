import {z} from 'zod';
import {synthesizeVoice,VoiceJob,VoiceResult} from './voice';

const lineSchema=z.strictObject({lineId:z.string().regex(/^[-a-zA-Z0-9_]{1,80}$/),language:z.enum(['zh-CN','en']),spokenText:z.string().trim().min(1).max(250),displayText:z.string().min(1).max(500),expectedAsrText:z.string().trim().min(1).max(500),startMs:z.number().int().nonnegative(),reservedMs:z.number().int().positive()});
const planSchema=z.strictObject({durationMs:z.number().int().min(20000).max(120000),lines:z.array(lineSchema).max(120)});
export type NarrationPlan=z.infer<typeof planSchema>;
export interface NarrationManifest{
 durationMs:number;
 lines:Array<{lineId:string;language:'zh-CN'|'en';spokenText:string;displayText:string;expectedAsrText:string;startMs:number;durationMs:number;reservedMs:number;voice:VoiceResult;asrStatus:'not_checked';wordTimingsStatus:'not_checked'}>;
}

export async function prepareNarration(plan:NarrationPlan,root:string,generate:(root:string,job:VoiceJob)=>Promise<VoiceResult>=synthesizeVoice):Promise<NarrationManifest>{
 const input=planSchema.parse(plan),seen=new Set<string>(),ordered=[...input.lines].sort((a,b)=>a.startMs-b.startMs);
 let reservedEnd=0;
 for(const line of ordered){
  if(seen.has(line.lineId)||line.startMs<reservedEnd||line.startMs+line.reservedMs>input.durationMs)throw Error('NARRATION_PLAN_INVALID');
  seen.add(line.lineId);reservedEnd=line.startMs+line.reservedMs;
 }
 const lines:NarrationManifest['lines']=[];
 for(const line of ordered){
  const voice=await generate(root,{lineId:line.lineId,language:line.language,text:line.spokenText});
  if(voice.lineId!==line.lineId||voice.language!==line.language||voice.wav.durationMs<=0)throw Error('VOICE_OUTPUT_INVALID');
  if(voice.wav.durationMs>line.reservedMs)throw Error('DURATION_CONFLICT');
  lines.push({...line,durationMs:voice.wav.durationMs,voice,asrStatus:'not_checked',wordTimingsStatus:'not_checked'});
 }
 return{durationMs:input.durationMs,lines};
}
