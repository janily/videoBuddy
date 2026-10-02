import {expect,it} from 'vitest';
import {initialUnderstanding} from '@/contracts/video/domain';
import type {VerifiedNarrationManifest} from '@/services/video/audio/asr';
import type {NarrationTrack} from '@/services/video/audio/mix';
import {getStyle} from '@/services/video/styles/registry';
import {compileVoicePlan} from '@/services/video/preview/voice-plan';
import {compileTimingDraft} from '@/services/video/preview/timing-draft';

const style=getStyle('crayon-book'),base=initialUnderstanding(),understanding={...base,briefVersion:1,subject:'活动预告',preferences:{...base.preferences,styleSlug:style.slug,durationSec:20}};
const shot={id:'shot',startFrame:0,endFrame:480,visualIntent:'日期',scriptLine:'十月八日见。',factIds:[]};
const treatment={schemaVersion:1,briefVersion:1,styleSlug:style.slug,styleRulesHash:style.rulesHash,durationSec:20,aspect:'16:9',fps:24,summary:'活动预告',options:[{id:'a',concept:'绘图',visualApproach:'蜡笔',soundApproach:'鼓点',tradeoff:'动画多'},{id:'b',concept:'纸页',visualApproach:'翻页',soundApproach:'纸声',tradeoff:'人物少'},{id:'c',concept:'角色',visualApproach:'走路',soundApproach:'脚步',tradeoff:'造型复杂'}],selectedOptionId:'a',selectionReason:'信息清晰',shots:[shot],script:[shot.scriptLine]};
const voicePlan=compileVoicePlan(treatment,understanding),voiceSha='a'.repeat(64),trackSha='b'.repeat(64),runtimeDigest='c'.repeat(64);
const line={...voicePlan.lines[0],durationMs:1000,voice:{lineId:'line_1',language:'zh-CN',voice:'zf_001',provider:'kokoro-js',model:'test',modelLicense:'Apache-2.0',runtimeDigest,outputPath:'/tmp/voice.wav',wav:{codec:'pcm_f32le',sampleRate:24000,channels:1,samples:24000,durationMs:1000,bytes:96044,sha256:voiceSha,peakDbfs:-10,rmsDbfs:-20}},asrStatus:'pass',wordTimingsStatus:'available',asr:{model:'Systran/faster-whisper-small',runtimeDigest,voiceSha256:voiceSha},recognizedText:'十月八日见。',wordTimings:[{text:'十月八日见',startMs:0,endMs:800,probability:0.9}]} as VerifiedNarrationManifest['lines'][number];
const verified:VerifiedNarrationManifest={durationMs:20000,lines:[line]};
const track={outputPath:'/tmp/track.wav',runtimeDigest,wav:{codec:'pcm_f32le',sampleRate:48000,channels:1,samples:960000,durationMs:20000,bytes:3840044,sha256:trackSha,peakDbfs:-10,rmsDbfs:-20,silence:false},kind:'narration_only',qaStatus:'not_checked'} as NarrationTrack;
const cue={lineId:'line_1',text:'十月八日见。',startFrame:0,endFrame:72,startMs:0,endMs:3000,voiceSha256:voiceSha};
const font={family:'Noto Sans CJK SC' as const,runtimeDigest,charsetSha256:'d'.repeat(64)};

it('T10 binds frozen shots, real voice samples, subtitle frames and the mixed track',()=>{
 const draft=compileTimingDraft(treatment,understanding,voicePlan,verified,[cue],track,font);
 expect(draft).toMatchObject({totalFrames:480,fps:24,sampleRate:48000,shots:[{id:'shot',startFrame:0,endFrame:480}],narration:[{lineId:'line_1',startSample:0,endSample:48000,voiceSha256:voiceSha}],captions:[{lineId:'line_1',startFrame:0,endFrame:72}],track:{sha256:trackSha,samples:960000}});
 expect(()=>compileTimingDraft(treatment,understanding,voicePlan,verified,[{...cue,voiceSha256:'e'.repeat(64)}],track,font)).toThrow('TIMING_CAPTION_SOURCE_CHANGED');
 expect(()=>compileTimingDraft(treatment,understanding,voicePlan,{...verified,lines:[{...line,startMs:19500}]},[cue],track,font)).toThrow('TIMING_VOICE_PLAN_CHANGED');
 expect(()=>compileTimingDraft(treatment,understanding,voicePlan,verified,[cue],{...track,wav:{...track.wav,samples:959999}},font)).toThrow('TIMING_TRACK_INVALID');
});
