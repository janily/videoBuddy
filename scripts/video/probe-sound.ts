import {mkdtemp,writeFile,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {buildSoundStems} from '../../src/services/video/audio/sound';
import type {AudioPlan} from '../../src/contracts/video/audio-plan';

async function main(){
 const root=await mkdtemp(join(tmpdir(),'vb-sound-probe-')),start=Date.now();
 const plan:AudioPlan={schemaVersion:1,briefVersion:1,styleSlug:'crayon-book',styleRulesHash:'a'.repeat(64),timingDraftHash:'b'.repeat(64),seed:42,sections:[{id:'whole',startFrame:0,endFrame:480,bpm:120,beatsPerBar:4,beatUnit:4,barOffset:0}],cues:[{id:'melody',sourceShotId:'shot',requestedTimeUs:1000000,alignmentPolicy:'audio'},{id:'tap',sourceShotId:'shot',requestedTimeUs:10000000,alignmentPolicy:'audio'}],sources:[{id:'string',kind:'synthesis',description:'拨弦',material:'合成弦',recipe:{instrument:'pluck',frequencyHz:440,attackMs:2,releaseMs:100}},{id:'paper',kind:'synthesis',description:'纸张摩擦',material:'纸张',recipe:{instrument:'noise',frequencyHz:1800,attackMs:5,releaseMs:80}}],music:[{eventId:'note',cueId:'melody',source:'string',durationSamples:48000,gainDb:-12,pan:-0.5}],foley:[{eventId:'paper',cueId:'tap',source:'paper',durationSamples:9600,gainDb:-15,pan:1}],intentionalSilenceRanges:[],mix:{targetLufs:-14,toleranceLu:1,maxTruePeakDbtp:-1.2,voiceGainDb:0,duck:{thresholdDb:-24,ratio:4,attackMs:10,releaseMs:180}},reasoning:'合成器技术测试，实际音色尚未听验。'};
 const digest='75ffd41e03d738cee7e10914aeaeb2605b9daf213409afec295ccb97bb06c919',env={VIDEO_MEDIA_IMAGE_REF:'sha256:'+digest,VIDEO_MEDIA_RUNTIME_DIGEST:digest,VIDEO_MEDIA_TIMEOUT_SECONDS:'180'};
 try{
  const result=await buildSoundStems(root,plan,20000,24,env),replay=await buildSoundStems(root,plan,20000,24,env);
  if(result.music.wav.sha256!==replay.music.wav.sha256||result.foley.wav.sha256!==replay.foley.wav.sha256)throw Error('AUDIO_REPLAY_CHANGED');
  const bytes=await readFile(result.foley.outputPath);let leftEnergy=0,rightEnergy=0,outsideEnergy=0;
  for(let i=0;i<960000;i++){const left=bytes.readFloatLE(44+i*8),right=bytes.readFloatLE(48+i*8);if(i>=480000&&i<489600){leftEnergy+=left*left;rightEnergy+=right*right}else outsideEnergy+=left*left+right*right}
  if(leftEnergy>1e-20||rightEnergy<1||outsideEnergy!==0)throw Error('AUDIO_PAN_OR_TIMING_FAILED');
  const evidence={executedAt:new Date().toISOString(),technicalProbeOnly:true,runtimeDigest:result.runtimeDigest,toolSha256:result.toolSha256,planSha256:result.planSha256,stageKey:result.stageKey,music:result.music.wav,foley:result.foley.wav,leftEnergy,rightEnergy,outsideEnergy,replayIdentical:true,durationMs:Date.now()-start,limits:'Actual pinned offline Docker synthesizer, stereo 48 kHz/sample alignment/seeded noise and replay. Synthetic plan, no model-authored score, user audio, voice ducking, final movie, listening or 43-style QA.'};
  await writeFile('docs/engineering/evidence/sound-probe.json',JSON.stringify(evidence,null,2)+'\n');console.log(JSON.stringify(evidence));
 }finally{await rm(root,{recursive:true,force:true})}
}
main().catch(error=>{console.error(error instanceof Error?error.message:'SOUND_PROBE_FAILED');process.exitCode=1});
