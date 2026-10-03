import {expect,it} from 'vitest';
import {createServer} from 'node:http';
import {initialUnderstanding} from '@/contracts/video/domain';
import {guardAudioPlan,compileAudioCues} from '@/contracts/video/audio-plan';
import {runAudioPlan} from '@/mastra/video/audio-plan';
import {getStyle} from '@/services/video/styles/registry';
import {canonicalHash} from '@/services/video/domain/hash';
import {TimingDraftSchema} from '@/services/video/preview/timing-draft';

const style=getStyle('crayon-book'),base=initialUnderstanding(),understanding={...base,briefVersion:1,subject:'活动预告',preferences:{...base.preferences,styleSlug:style.slug,durationSec:20,voiceMode:'none' as const}};
const shot={id:'opening',startFrame:0,endFrame:480,visualIntent:'绘出活动日期',scriptLine:'十月八日见。',factIds:[]};
const treatment={schemaVersion:1,briefVersion:1,styleSlug:style.slug,styleRulesHash:style.rulesHash,durationSec:20,aspect:'16:9',fps:24,summary:'活动预告',options:[{id:'a',concept:'绘图',visualApproach:'蜡笔',soundApproach:'鼓点',tradeoff:'动画多'},{id:'b',concept:'纸页',visualApproach:'翻页',soundApproach:'纸声',tradeoff:'人物少'},{id:'c',concept:'角色',visualApproach:'走路',soundApproach:'脚步',tradeoff:'造型复杂'}],selectedOptionId:'a',selectionReason:'信息清晰',shots:[shot],script:[shot.scriptLine]};
const timing=TimingDraftSchema.parse({schemaVersion:1,briefVersion:1,styleSlug:style.slug,styleRulesHash:style.rulesHash,durationMs:20000,totalFrames:480,fps:24,sampleRate:48000,shots:[{id:'opening',startFrame:0,endFrame:480,visualIntent:shot.visualIntent,factIds:[]}],narration:[],captions:[],track:{outputPath:'/tmp/audio/track.wav',sha256:'a'.repeat(64),samples:960000,runtimeDigest:'b'.repeat(64),silence:true},font:null,qualityStatus:'semantic_not_checked'}),timingHash=canonicalHash(timing);
const plan={schemaVersion:1,briefVersion:1,styleSlug:style.slug,styleRulesHash:style.rulesHash,timingDraftHash:timingHash,seed:3,sections:[{id:'whole',startFrame:0,endFrame:480,bpm:120,beatsPerBar:4,beatUnit:4,barOffset:0}],cues:[{id:'hit',sourceShotId:'opening',requestedTimeUs:1,alignmentPolicy:'audio'}],sources:[{id:'pluck',kind:'synthesis',description:'纸页轻弹的声音',material:'纸',recipe:{instrument:'pluck',frequencyHz:220,attackMs:5,releaseMs:200}}],music:[{eventId:'note',cueId:'hit',source:'pluck',pitch:1,durationSamples:24000,gainDb:-18,pan:0}],foley:[],intentionalSilenceRanges:[],mix:{targetLufs:-14,toleranceLu:1,maxTruePeakDbtp:-1.2,voiceGainDb:0,duck:{thresholdDb:-24,ratio:4,attackMs:10,releaseMs:180}},reasoning:'短拨弦与纸页运动协调。'};

it('T06/T10 validates frozen audio events, absolute cue quantization and protected mix targets',()=>{
 expect(guardAudioPlan(plan,understanding,treatment,timing,timingHash,3)).toMatchObject({seed:3});
 expect(compileAudioCues(guardAudioPlan(plan,understanding,treatment,timing,timingHash,3),24)[0]).toMatchObject({resolvedSample:0,quantizationErrorUs:-1});
 expect(()=>guardAudioPlan({...plan,seed:4},understanding,treatment,timing,timingHash,3)).toThrow('AUDIO_BASELINE_CHANGED');
 expect(()=>guardAudioPlan({...plan,sections:[{...plan.sections[0],startFrame:1}]},understanding,treatment,timing,timingHash,3)).toThrow('AUDIO_TIMELINE_INVALID');
 expect(()=>guardAudioPlan({...plan,music:[{...plan.music[0],durationSamples:960001}]},understanding,treatment,timing,timingHash,3)).toThrow('AUDIO_EVENT_INVALID');
 expect(()=>guardAudioPlan({...plan,music:[{...plan.music[0],source:'unknown'}]},understanding,treatment,timing,timingHash,3)).toThrow('AUDIO_EVENT_INVALID');
 expect(()=>guardAudioPlan({...plan,music:[],sources:[],cues:[]},understanding,treatment,timing,timingHash,3)).toThrow('AUDIO_MUSIC_INTENT_CHANGED');
 const noMusic={...understanding,preferences:{...understanding.preferences,musicMode:'none' as const}};
 expect(()=>guardAudioPlan(plan,noMusic,treatment,timing,timingHash,3)).toThrow('AUDIO_MUSIC_INTENT_CHANGED');
 expect(()=>guardAudioPlan({...plan,mix:{...plan.mix,targetLufs:-20}},understanding,treatment,timing,timingHash,3)).toThrow('AUDIO_PLAN_INVALID');
 expect(()=>guardAudioPlan({...plan,qualityStatus:'pass'},understanding,treatment,timing,timingHash,3)).toThrow('AUDIO_PLAN_INVALID');
});

it('T06 sends frozen clock, seed, selected STYLE and audio intent through the actual Mastra adapter',async()=>{
 const requests:Record<string,unknown>[]=[];
 const server=createServer(async(req,res)=>{
  let body='';for await(const part of req)body+=part;const parsed=JSON.parse(body) as Record<string,unknown>;requests.push(parsed);
  const content=JSON.stringify(plan);
  if(!parsed.stream){res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({id:'audio-test',object:'chat.completion',created:1,model:'test-model',choices:[{index:0,message:{role:'assistant',content},finish_reason:'stop'}],usage:{prompt_tokens:100,completion_tokens:100,total_tokens:200}}));return}
  res.writeHead(200,{'content-type':'text/event-stream'});
  res.write('data: '+JSON.stringify({id:'audio-test',object:'chat.completion.chunk',created:1,model:'test-model',choices:[{index:0,delta:{role:'assistant',content},finish_reason:null}]})+'\n\n');
  res.end('data: '+JSON.stringify({id:'audio-test',object:'chat.completion.chunk',created:1,model:'test-model',choices:[{index:0,delta:{},finish_reason:'stop'}],usage:{prompt_tokens:100,completion_tokens:100,total_tokens:200}})+'\n\ndata: [DONE]\n\n');
 });
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address();if(!address||typeof address==='string')throw Error('TEST_SERVER_FAILED');
 try{
  const output=await runAudioPlan(understanding,treatment,timing,timingHash,3,12000,{MODEL_PROVIDER:'openai-compatible',MODEL_BASE_URL:`http://127.0.0.1:${address.port}/v1`,MODEL_API_KEY:'local-test-only',VIDEO_AUDIO_MODEL:'test-model'});
  expect(output.music).toHaveLength(1);expect(JSON.stringify(requests[0])).toContain(style.rulesHash);expect(JSON.stringify(requests[0])).toContain(timingHash);expect(JSON.stringify(requests[0])).toContain('composed');
 }finally{await new Promise<void>(resolve=>server.close(()=>resolve()))}
});
