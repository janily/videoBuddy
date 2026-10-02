import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {synthesizeVoice} from '../../src/services/video/audio/voice';
import {prepareNarration} from '../../src/services/video/audio/narration';
import {buildNarrationTrack} from '../../src/services/video/audio/mix';

async function windowRms(path:string,startMs:number,endMs:number){
 const bytes=await readFile(path);let offset=12,data=-1;
 while(offset+8<=bytes.length){const length=bytes.readUInt32LE(offset+4);if(bytes.toString('ascii',offset,offset+4)==='data'){data=offset+8;break}offset+=8+length+(length%2)}
 if(data<0)throw Error('VOICE_PROBE_FAILED');
 let sum=0,count=0;
 for(let i=startMs*48;i<endMs*48;i++){const value=bytes.readFloatLE(data+i*4);sum+=value*value;count++}
 return Math.sqrt(sum/count);
}

async function main(){
 const image=process.env.VIDEO_VOICE_IMAGE_REF,digest=process.env.VIDEO_VOICE_RUNTIME_DIGEST;
 if(!image||!digest||image!==`sha256:${digest}`)throw Error('CONFIGURATION_REQUIRED: pinned offline voice image');
 const root=await mkdtemp(join(tmpdir(),'vb-voice-probe-'));
 try{
  const plan=await prepareNarration({durationMs:20000,lines:[
   {lineId:'probe_zh',language:'zh-CN',spokenText:'上海的活动将在十月八日开始。',displayText:'上海活动 · 10月8日',expectedAsrText:'上海的活动将在十月八日开始',startMs:1000,reservedMs:6000},
   {lineId:'probe_en',language:'en',spokenText:'The event in Shanghai begins on October eighth.',displayText:'Shanghai · October 8',expectedAsrText:'The event in Shanghai begins on October eighth',startMs:8000,reservedMs:6000},
  ]},root);
  const chinese=plan.lines[0].voice,english=plan.lines[1].voice;
  const track=await buildNarrationTrack(root,plan);
  const silentTrack=await buildNarrationTrack(root,await prepareNarration({durationMs:20000,lines:[]},root));
  const trackReplay=await buildNarrationTrack(root,plan);
  const windows={before:await windowRms(track.outputPath,0,800),chinese:await windowRms(track.outputPath,1500,4500),between:await windowRms(track.outputPath,5500,7500),english:await windowRms(track.outputPath,8500,11000),after:await windowRms(track.outputPath,12500,19000)};
  const replay=await synthesizeVoice(root,{lineId:'probe_zh',language:'zh-CN',text:'上海的活动将在十月八日开始。'});
  if(replay.wav.sha256!==chinese.wav.sha256||trackReplay.wav.sha256!==track.wav.sha256||!silentTrack.wav.silence||chinese.wav.durationMs<200||english.wav.durationMs<200||windows.before>0.0001||windows.between>0.0001||windows.after>0.0001||windows.chinese<0.003||windows.english<0.003)throw Error('VOICE_PROBE_FAILED');
  const evidence={runtimeDigest:digest,mediaRuntimeDigest:track.runtimeDigest,provider:'kokoro-js@1.2.4',offline:true,network:'none',narrationPlan:{durationMs:plan.durationMs,lines:plan.lines.map(line=>({lineId:line.lineId,startMs:line.startMs,reservedMs:line.reservedMs,actualDurationMs:line.durationMs,asrStatus:line.asrStatus,wordTimingsStatus:line.wordTimingsStatus}))},chinese:{text:'上海的活动将在十月八日开始。',voice:chinese.voice,...chinese.wav},english:{text:'The event in Shanghai begins on October eighth.',voice:english.voice,...english.wav},track:{kind:track.kind,qaStatus:track.qaStatus,...track.wav,windowRms:windows},intentionalSilence:{samples:silentTrack.wav.samples,durationMs:silentTrack.wav.durationMs,silence:silentTrack.wav.silence},sameStageReplay:true,limits:'WAV format, non-silence, hash, duration and 48 kHz narration-only track checked; speech recognition, intelligibility, alignment, music, loudness and final mix QA not checked'};
  if(process.argv.includes('--record'))await writeFile('docs/engineering/evidence/voice-probe.json',JSON.stringify(evidence,null,2)+'\n');
  process.stdout.write(JSON.stringify(evidence)+'\n');
 }finally{await rm(root,{recursive:true,force:true})}
}
main().catch(error=>{console.error(error);process.exitCode=1});
