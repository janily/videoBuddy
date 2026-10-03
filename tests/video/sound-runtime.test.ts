import {it,expect} from 'vitest';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {compileSoundJob} from '@/services/video/audio/sound';
import {probeStereoTrackWav} from '@/services/video/audio/wav';
import type {AudioPlan} from '@/contracts/video/audio-plan';

const plan:AudioPlan={schemaVersion:1,briefVersion:1,styleSlug:'crayon-book',styleRulesHash:'a'.repeat(64),timingDraftHash:'b'.repeat(64),seed:42,sections:[{id:'whole',startFrame:0,endFrame:480,bpm:120,beatsPerBar:4,beatUnit:4,barOffset:0}],cues:[{id:'note',sourceShotId:'shot',requestedTimeUs:1000000,alignmentPolicy:'audio'}],sources:[{id:'noise',kind:'synthesis',description:'纸张摩擦',material:'纸张',recipe:{instrument:'noise',frequencyHz:500,attackMs:2,releaseMs:40}}],music:[],foley:[{eventId:'paper',cueId:'note',source:'noise',durationSamples:4800,gainDb:-12,pan:-1}],intentionalSilenceRanges:[],mix:{targetLufs:-14,toleranceLu:1,maxTruePeakDbtp:-1.2,voiceGainDb:0,duck:{thresholdDb:-24,ratio:4,attackMs:10,releaseMs:180}},reasoning:'只验证已声明纸张拟音的时间、声道与随机种子。'};
it('trusted synthesis respects exact absolute samples, pan and deterministic seeded noise; corrupt output is not overwritten',async()=>{
 const root=await mkdtemp(join(tmpdir(),'vb-sound-test-'));
 try{
  const job=compileSoundJob(plan,20000,24),input=join(root,'job.json');await writeFile(input,JSON.stringify(job));
  const run=(output:string)=>spawnSync('python3',[resolve('runtime/media/sound.py'),'--job',input,'--output',join(root,output)],{encoding:'utf8'});
  expect(run('one').status).toBe(0);expect(run('two').status).toBe(0);
  const a=await readFile(join(root,'one','foley.wav')),b=await readFile(join(root,'two','foley.wav'));
  expect(a.equals(b)).toBe(true);const probe=probeStereoTrackWav(a,960000,false);
  expect(probe.channels).toBe(2);expect(probe.samples).toBe(960000);
  let before=0,left=0,right=0,after=0;
  for(let frame=0;frame<960000;frame++){const l=a.readFloatLE(44+frame*8),r=a.readFloatLE(48+frame*8);if(frame<48000)before+=l*l+r*r;else if(frame<52800){left+=l*l;right+=r*r}else after+=l*l+r*r}
  expect(before).toBe(0);expect(after).toBe(0);expect(left).toBeGreaterThan(1);expect(right).toBeLessThan(1e-20);
  expect(probeStereoTrackWav(await readFile(join(root,'one','music.wav')),960000,true).silence).toBe(true);
  const source=plan.sources[0];if(source.kind!=='synthesis')throw Error('TEST_SOURCE_INVALID');
  const quietJob=compileSoundJob({...plan,sources:[{...source,recipe:{instrument:'sine',frequencyHz:500,attackMs:2,releaseMs:40}}],foley:[{...plan.foley[0],gainDb:-30,pan:0}]},20000,24);
  await writeFile(input,JSON.stringify(quietJob));expect(run('quiet').status).toBe(0);
  const quiet=probeStereoTrackWav(await readFile(join(root,'quiet','foley.wav')),960000,false);
  expect(quiet.silence).toBe(false);expect(quiet.rmsDbfs!).toBeLessThan(-60);expect(quiet.peakDbfs!).toBeGreaterThan(-40);
  await writeFile(input,JSON.stringify(job));
  expect(run('one').status).toBe(0);
  await writeFile(join(root,'one','foley.wav'),'corrupt');
  expect(run('one').status).not.toBe(0);expect(await readFile(join(root,'one','foley.wav'),'utf8')).toBe('corrupt');
 }finally{await rm(root,{recursive:true,force:true})}
},15000);
it('rejects unresolved sources, unsupported user audio and out-of-range events before executing audio',()=>{
 expect(()=>compileSoundJob({...plan,foley:[{...plan.foley[0],source:'missing'}]},20000,24)).toThrow('AUDIO_EVENT_INVALID');
 expect(()=>compileSoundJob({...plan,sources:[{id:'noise',kind:'user_track',description:'授权上传',assetId:'10000000-0000-4000-8000-000000000001'}]},20000,24)).toThrow('AUDIO_USER_TRACK_NOT_READY');
 expect(()=>compileSoundJob({...plan,foley:[{...plan.foley[0],durationSamples:960000}]},20000,24)).toThrow('AUDIO_EVENT_INVALID');
});
