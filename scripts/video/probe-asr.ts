import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {prepareNarration} from '../../src/services/video/audio/narration';
import {transcribeVoice,verifyNarration,verifySpokenText} from '../../src/services/video/audio/asr';

async function main(){
 const root=await mkdtemp(join(tmpdir(),'vb-asr-probe-'));
 try{
  const jobs=[
   {lineId:'asr_zh',language:'zh-CN' as const,text:'上海的活动将在十月八日开始。',expected:'上海的活动将在十月八日开始'},
   {lineId:'asr_en',language:'en' as const,text:'The event starts in Shanghai.',expected:'The event starts in Shanghai'},
  ];
  const originalPlan={durationMs:20000,lines:jobs.map((job,index)=>({lineId:job.lineId,language:job.language,spokenText:job.text,displayText:job.text,expectedAsrText:job.expected,startMs:index*8000+1000,reservedMs:6000}))};
  const manifest=await prepareNarration(originalPlan,root),verified=await verifyNarration(originalPlan,manifest,root);
  const outputs=[];
  let wrongDateRejected=false;
  for(const [index,job] of jobs.entries()){
   const voice=manifest.lines[index].voice,transcript=await transcribeVoice(root,voice),line=verified.lines[index];
   if(job.language==='zh-CN'){
    try{verifySpokenText('上海的活动将在十月九日开始','上海的活动将在十月九日开始',transcript)}catch(error){if((error as Error).message==='ASR_MISMATCH')wrongDateRejected=true;else throw error}
   }
   const replay=await transcribeVoice(root,voice);
   if(replay.recognizedText!==transcript.recognizedText||line.wordTimings.length===0)throw Error('ASR_PROBE_FAILED');
   outputs.push({language:job.language,spokenText:job.text,expectedAsrText:job.expected,recognizedText:line.recognizedText,wordCount:line.wordTimings.length,words:line.wordTimings,voiceSha256:voice.wav.sha256,voiceDurationMs:voice.wav.durationMs,asrRuntimeDigest:transcript.runtimeDigest,voiceRuntimeDigest:voice.runtimeDigest,status:line.asrStatus,wordTimingsStatus:line.wordTimingsStatus,sameStageReplay:true});
  }
  if(!wrongDateRejected)throw Error('ASR_PROBE_FAILED: incorrect date passed');
  const evidence={model:'Systran/faster-whisper-small@2ec96c5472da50d38d40c0cfe0602af2e94b4c8a',network:'none',inputBlind:true,wrongDateRejected,outputs,limits:'Short clean synthetic speech only; model fallibility, unusual names, long or user-supplied mixed audio and listening QA remain unchecked'};
  if(process.argv.includes('--record'))await writeFile('docs/engineering/evidence/asr-probe.json',JSON.stringify(evidence,null,2)+'\n');
  process.stdout.write(JSON.stringify(evidence)+'\n');
 }finally{await rm(root,{recursive:true,force:true})}
}
main().catch(error=>{console.error(error);process.exitCode=1});
