import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {buildSoundStems} from '../../src/services/video/audio/sound';
import {buildAudioMaster} from '../../src/services/video/audio/master';
import {probeTrackWav} from '../../src/services/video/audio/wav';
import type {AudioPlan} from '../../src/contracts/video/audio-plan';
async function main(){
 const root=await mkdtemp(join(tmpdir(),'vb-master-probe-')),samples=960000,buffer=Buffer.alloc(44+samples*4);
 buffer.write('RIFF',0);buffer.writeUInt32LE(buffer.length-8,4);buffer.write('WAVEfmt ',8);buffer.writeUInt32LE(16,16);buffer.writeUInt16LE(3,20);buffer.writeUInt16LE(1,22);buffer.writeUInt32LE(48000,24);buffer.writeUInt32LE(192000,28);buffer.writeUInt16LE(4,32);buffer.writeUInt16LE(32,34);buffer.write('data',36);buffer.writeUInt32LE(samples*4,40);
 for(let i=3*48000;i<7*48000;i++)buffer.writeFloatLE(0.4*Math.sin(2*Math.PI*880*i/48000),44+i*4);
 const plan:AudioPlan={schemaVersion:1,briefVersion:1,styleSlug:'crayon-book',styleRulesHash:'a'.repeat(64),timingDraftHash:'b'.repeat(64),seed:42,sections:[{id:'whole',startFrame:0,endFrame:480,bpm:120,beatsPerBar:4,beatUnit:4,barOffset:0}],cues:[{id:'bed',sourceShotId:'shot',requestedTimeUs:0,alignmentPolicy:'audio'}],sources:[{id:'string',kind:'synthesis',description:'持续测试音',material:'合成正弦',recipe:{instrument:'sine',frequencyHz:220,attackMs:5,releaseMs:100}}],music:[{eventId:'note',cueId:'bed',source:'string',durationSamples:samples,gainDb:-24,pan:0}],foley:[],intentionalSilenceRanges:[],mix:{targetLufs:-14,toleranceLu:1,maxTruePeakDbtp:-1.2,voiceGainDb:0,duck:{thresholdDb:-30,ratio:8,attackMs:10,releaseMs:180}},reasoning:'混音器测试，以880Hz替代人声信号仅用于独立测量220Hz背景ducking，不是真实旁白。'};
 const digest='75ffd41e03d738cee7e10914aeaeb2605b9daf213409afec295ccb97bb06c919',env={VIDEO_MEDIA_IMAGE_REF:'sha256:'+digest,VIDEO_MEDIA_RUNTIME_DIGEST:digest,VIDEO_MEDIA_TIMEOUT_SECONDS:'180'};
 try{
  const voiceDir=join(root,'audio','fixture');await mkdir(voiceDir,{recursive:true});const outputPath=join(voiceDir,'track.wav');await writeFile(outputPath,buffer);
  const voice={outputPath,runtimeDigest:digest,wav:probeTrackWav(buffer,samples,false),kind:'narration_only' as const,qaStatus:'not_checked' as const},stems=await buildSoundStems(root,plan,20000,24,env);
  const result=await buildAudioMaster(root,plan,voice,stems,20000,24,env),replay=await buildAudioMaster(root,plan,voice,stems,20000,24,env);
  if(result.track.wav.sha256!==replay.track.wav.sha256)throw Error('MASTER_REPLAY_CHANGED');
  const data=await readFile(result.track.outputPath);
  let offset=12,pcmOffset=0;while(offset+8<=data.length){const size=data.readUInt32LE(offset+4);if(data.toString('ascii',offset,offset+4)==='data'){pcmOffset=offset+8;break}offset+=8+size+size%2}
  if(!pcmOffset)throw Error('MASTER_OUTPUT_INVALID');
  function amplitude(startSec:number){let real=0,imag=0;const count=48000;for(let i=0;i<count;i++){const frame=startSec*48000+i,value=data.readFloatLE(pcmOffset+frame*8),angle=2*Math.PI*220*frame/48000;real+=value*Math.cos(angle);imag-=value*Math.sin(angle)}return 2*Math.hypot(real,imag)/count}
  const before=amplitude(1),during=amplitude(5),after=amplitude(10),duckDb=20*Math.log10(during/before);
  if(before<0.01||duckDb>-8||Math.abs(after/before-1)>0.02)throw Error('MASTER_DUCK_FAILED');
  await writeFile(result.track.outputPath,'intentional tamper');
  let tamperRejected=false;try{await buildAudioMaster(root,plan,voice,stems,20000,24,env)}catch{tamperRejected=true}
  if(!tamperRejected)throw Error('MASTER_TAMPER_ACCEPTED');
  const evidence={executedAt:new Date().toISOString(),technicalProbeOnly:true,runtimeDigest:digest,toolSha256:result.toolSha256,planSha256:result.planSha256,stageKey:result.stageKey,voiceSha256:result.voiceSha256,musicSha256:result.musicSha256,foleySha256:result.foleySha256,master:result.track.wav,music220HzAmplitude:{before,during,after,duckDb},replayIdentical:true,tamperRejected,limits:'Actual pinned offline Docker/FFmpeg master mix, stereo, exact samples, frozen gain/duck parameters and measured attenuation/recovery. 880Hz test signal is explicitly not TTS/user speech; no final AAC, ASR, loudness, listening/style QA or user preview.'};
  await writeFile('docs/engineering/evidence/master-probe.json',JSON.stringify(evidence,null,2)+'\n');console.log(JSON.stringify(evidence));
 }finally{await rm(root,{recursive:true,force:true})}
}
main().catch(error=>{console.error(error instanceof Error?error.message:'MASTER_PROBE_FAILED');process.exitCode=1});
