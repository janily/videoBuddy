import {mkdir,mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {FileStore} from '../../src/services/video/storage/file-store';
import type {Understanding} from '../../src/contracts/video/domain';
import type {ProjectControl} from '../../src/contracts/video/project';
import {canonicalHash} from '../../src/services/video/domain/hash';
import {compileVoicePlan} from '../../src/services/video/preview/voice-plan';
import {prepareNarration} from '../../src/services/video/audio/narration';
import {synthesizeVoice} from '../../src/services/video/audio/voice';
import {transcribeVoice,verifySpokenText} from '../../src/services/video/audio/asr';
import {probeEnvironment} from './helpers/real-probe';

async function main(){
 if(!process.argv.includes('--voice-front-end'))throw Error('VOICE_FRONTEND_OPT_IN_REQUIRED');
 const image=process.env.VIDEO_VOICE_IMAGE_REF,digest=process.env.VIDEO_VOICE_RUNTIME_DIGEST;
 if(!digest||image!=='sha256:'+digest||digest==='831c0ff8261e75468b3a6868ca29f5b3fd1eee6b222031912eff4e13071e6e64')throw Error('NEW_VOICE_RUNTIME_REQUIRED');
 const source=JSON.parse(await readFile('docs/engineering/evidence/new-theme-probe.json','utf8')),store=new FileStore(source.root),prefix=`projects/${source.projectId}`,before=(await store.readFresh<ProjectControl>(prefix+'/control')).value,budgetBefore=(await store.readFresh(prefix+'/budget')).value;
 const understanding=(await store.readFresh<Understanding>(before.understandingRef.key)).value;if(canonicalHash(understanding)!==before.understandingRef.sha256)throw Error('SOURCE_CHANGED');
 const keys=await store.listKeys(`${prefix}/revisions/${source.stages.operation.revisionId}/treatment-plan`,1);if(keys.length!==1)throw Error('TREATMENT_SOURCE_REQUIRED');
 const treatment=(await store.readFresh(keys[0])).value;if(!keys[0].endsWith('/'+canonicalHash(treatment)))throw Error('SOURCE_CHANGED');
 const plan=compileVoicePlan(treatment,understanding),parent=resolve('.video-local/voice-front-end');await mkdir(parent,{recursive:true,mode:0o700});const root=await mkdtemp(join(parent,'probe-'));
 const env={...probeEnvironment(root),VIDEO_VOICE_IMAGE_REF:image,VIDEO_VOICE_RUNTIME_DIGEST:digest};let networkCalls=0;globalThis.fetch=async()=>{networkCalls++;throw Error('VOICE_FRONTEND_NETWORK_FORBIDDEN')};
 const report:{executedAt:string;status:string;root:string;sourceRoot:string;sourceProjectId:string;sourcePlanHash:string;voiceRuntimeDigest:string;lines:unknown[];errorCode?:string;networkCalls:number;limits:string}={executedAt:new Date().toISOString(),status:'running',root,sourceRoot:source.root,sourceProjectId:source.projectId,sourcePlanHash:canonicalHash(plan),voiceRuntimeDigest:digest,lines:[],networkCalls:0,limits:'Actual offline new-runtime TTS and independent input-blind ASR of the unchanged four frozen new-theme lines, plus two separately marked historic date/English regressions. No regenerated script or model call. Failures retained; this is not final AAC/postmix, listening, special-name or 43-style QA. Original failed preview/control/budget and historical unknown effects remain unchanged.'};
 const reportPath='docs/engineering/evidence/voice-front-end-probe.json';async function record(){report.networkCalls=networkCalls;await writeFile(reportPath,JSON.stringify(report,null,2)+'\n')}
 try{
  await record();const narration=await prepareNarration(plan,root,(dir,job)=>synthesizeVoice(dir,job,env));
  const regression=await prepareNarration({durationMs:20000,lines:[
   {lineId:'frontend_date',language:'zh-CN',spokenText:'上海的活动将在十月八日开始。',displayText:'上海活动 · 10月8日',expectedAsrText:'上海的活动将在十月八日开始',startMs:1000,reservedMs:6000},
   {lineId:'frontend_english',language:'en',spokenText:'The event in Shanghai begins on October eighth.',displayText:'Shanghai · October 8',expectedAsrText:'The event in Shanghai begins on October eighth',startMs:8000,reservedMs:6000},
  ]},root,(dir,job)=>synthesizeVoice(dir,job,env));
  for(const line of [...narration.lines,...regression.lines]){
   const transcript=await transcribeVoice(root,line.voice,env);let status='pass',errorCode;
   try{verifySpokenText(line.expectedAsrText,line.expectedAsrText,transcript)}catch(error){status='fail';errorCode=error instanceof Error?error.message:'ASR_FAILED'}
   report.lines.push({scenario:line.lineId.startsWith('frontend_')?'date_english_regression':'frozen_new_theme',lineId:line.lineId,spokenText:line.spokenText,expectedAsrText:line.expectedAsrText,recognizedText:transcript.recognizedText,wav:line.voice.wav,outputPath:line.voice.outputPath,asrRuntimeDigest:transcript.runtimeDigest,status,...(errorCode?{errorCode}:{})});await record();console.log(JSON.stringify({lineId:line.lineId,status,...(errorCode?{errorCode}:{})}));
  }
  if(canonicalHash((await store.readFresh(prefix+'/control')).value)!==canonicalHash(before)||canonicalHash((await store.readFresh(prefix+'/budget')).value)!==canonicalHash(budgetBefore)||networkCalls)throw Error('SOURCE_CHANGED');
  report.status=report.lines.every(line=>(line as {status:string}).status==='pass')?'pass':'blocked';if(report.status!=='pass')process.exitCode=1;
 }catch(error){report.status='blocked';report.errorCode=error instanceof Error?error.message:'VOICE_FRONTEND_FAILED';process.exitCode=1}
 finally{await record();console.log(JSON.stringify({status:report.status,root,lines:report.lines.length,errorCode:report.errorCode,networkCalls}))}
}
main().catch(error=>{console.error(JSON.stringify({status:'fail',errorCode:error.message}));process.exitCode=1});
