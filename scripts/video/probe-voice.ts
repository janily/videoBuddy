import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {synthesizeVoice} from '../../src/services/video/audio/voice';

async function main(){
 const image=process.env.VIDEO_VOICE_IMAGE_REF,digest=process.env.VIDEO_VOICE_RUNTIME_DIGEST;
 if(!image||!digest||image!==`sha256:${digest}`)throw Error('CONFIGURATION_REQUIRED: pinned offline voice image');
 const root=await mkdtemp(join(tmpdir(),'vb-voice-probe-'));
 try{
  const chinese=await synthesizeVoice(root,{lineId:'probe_zh',language:'zh-CN',text:'上海的活动将在十月八日开始。'});
  const english=await synthesizeVoice(root,{lineId:'probe_en',language:'en',text:'The event in Shanghai begins on October eighth.'});
  const replay=await synthesizeVoice(root,{lineId:'probe_zh',language:'zh-CN',text:'上海的活动将在十月八日开始。'});
  if(replay.wav.sha256!==chinese.wav.sha256||chinese.wav.durationMs<200||english.wav.durationMs<200)throw Error('VOICE_PROBE_FAILED');
  const evidence={runtimeDigest:digest,provider:'kokoro-js@1.2.4',offline:true,network:'none',chinese:{text:'上海的活动将在十月八日开始。',voice:chinese.voice,...chinese.wav},english:{text:'The event in Shanghai begins on October eighth.',voice:english.voice,...english.wav},sameStageReplay:true,limits:'WAV format, non-silence, hash and duration checked; speech recognition, intelligibility, alignment and 48 kHz mix not checked'};
  if(process.argv.includes('--record'))await writeFile('docs/engineering/evidence/voice-probe.json',JSON.stringify(evidence,null,2)+'\n');
  process.stdout.write(JSON.stringify(evidence)+'\n');
 }finally{await rm(root,{recursive:true,force:true})}
}
main().catch(error=>{console.error(error);process.exitCode=1});
