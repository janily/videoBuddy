import {readFile,writeFile} from 'node:fs/promises';
import {canonicalHash} from '../../src/services/video/domain/hash';
import {FileStore} from '../../src/services/video/storage/file-store';
import {transcribeAudio,verifySpokenText} from '../../src/services/video/audio/asr';
import type {VoiceWavProbe} from '../../src/services/video/audio/wav';
import {probeEnvironment} from './helpers/real-probe';

interface SavedLine{scenario:string;lineId:string;spokenText:string;expectedAsrText:string;outputPath:string;wav:VoiceWavProbe;status:string}
async function main(){
 if(!process.argv.includes('--asr-date-recheck'))throw Error('ASR_DATE_RECHECK_OPT_IN_REQUIRED');
 const source=JSON.parse(await readFile('docs/engineering/evidence/voice-front-end-probe.json','utf8')) as {root:string;sourceRoot:string;sourceProjectId:string;lines:SavedLine[]};
 const store=new FileStore(source.sourceRoot),prefix=`projects/${source.sourceProjectId}`,controlBefore=(await store.readFresh(prefix+'/control')).value,budgetBefore=(await store.readFresh(prefix+'/budget')).value;
 const env=probeEnvironment(source.root),originalFetch=globalThis.fetch;let networkCalls=0;
 globalThis.fetch=async()=>{networkCalls++;throw Error('ASR_RECHECK_NETWORK_FORBIDDEN')};
 const lines:Array<{lineId:string;scenario:string;expectedAsrText:string;recognizedText:string;sourceWavSha256:string;status:string;errorCode?:string}>=[];
 try{
  for(const line of source.lines){
   const language=line.lineId==='frontend_english'?'en':'zh-CN';
   // Existing audio and actual blind transcript only; missing records reject.
   const transcript=await transcribeAudio(source.root,{language,outputPath:line.outputPath,wav:line.wav},'voice',env,{mustExist:true});
   let status='pass',errorCode;
   try{verifySpokenText(line.expectedAsrText,line.expectedAsrText,transcript)}catch(error){status='fail';errorCode=error instanceof Error?error.message:'ASR_RECHECK_FAILED'}
   lines.push({lineId:line.lineId,scenario:line.scenario,expectedAsrText:line.expectedAsrText,recognizedText:transcript.recognizedText,sourceWavSha256:line.wav.sha256,status,...(errorCode?{errorCode}:{})});
  }
  if(canonicalHash((await store.readFresh(prefix+'/control')).value)!==canonicalHash(controlBefore)||canonicalHash((await store.readFresh(prefix+'/budget')).value)!==canonicalHash(budgetBefore)||networkCalls)throw Error('SOURCE_CHANGED');
  const report={executedAt:new Date().toISOString(),sourceEvidenceHash:canonicalHash(source),sourceRoot:source.root,status:lines.every(line=>line.status==='pass')?'pass':'blocked',lines,networkCalls,mediaExecutions:0,providerCalls:0,sourceControlAndBudgetUnchanged:true,limits:'Read-only recheck of existing independently generated WAV/transcript bytes. English month/day ordinal notation is normalized for comparison; frozen expectations and old failure report are unchanged. Chinese homophones/proper-name differences remain rejected. No new TTS, ASR execution, audio or preview publication.'};
  await writeFile('docs/engineering/evidence/asr-date-recheck-probe.json',JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({status:report.status,passed:lines.filter(line=>line.status==='pass').length,failed:lines.filter(line=>line.status==='fail').length,networkCalls}));
  if(report.status!=='pass')process.exitCode=1;
 }finally{globalThis.fetch=originalFetch}
}
main().catch(error=>{console.error(JSON.stringify({status:'fail',errorCode:error.message}));process.exitCode=1});
