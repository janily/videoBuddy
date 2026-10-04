import {randomUUID} from 'node:crypto';
import {copyFile,mkdir,mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {FileStore} from '../../src/services/video/storage/file-store';
import {canonicalHash} from '../../src/services/video/domain/hash';
import {inspectVoiceWav} from '../../src/services/video/audio/wav';
import {asrConfiguration,transcribeAudio,verifySpokenText} from '../../src/services/video/audio/asr';
import {probeEnvironment} from './helpers/real-probe';

async function main(){
 if(!process.argv.includes('--medium-runtime'))throw Error('MEDIUM_RUNTIME_OPT_IN_REQUIRED');
 const image=process.env.VIDEO_ASR_IMAGE_REF,digest=process.env.VIDEO_ASR_RUNTIME_DIGEST;
 if(!digest||image!=='sha256:'+digest||digest==='67786e6dbdd6b00f6177441e64272b622f844fc6c69b39970543afa92cc4895c')throw Error('NEW_ASR_RUNTIME_REQUIRED');
 const source=JSON.parse(await readFile('docs/engineering/evidence/voice-front-end-probe.json','utf8'));
 if(source.lines.length!==6)throw Error('FROZEN_SIX_LINES_REQUIRED');
 const parent=resolve('.video-local/asr-medium-runtime');await mkdir(parent,{recursive:true,mode:0o700});const root=await mkdtemp(join(parent,'probe-'));
 const env={...probeEnvironment(root),VIDEO_ASR_IMAGE_REF:image,VIDEO_ASR_RUNTIME_DIGEST:digest,VIDEO_ASR_MODEL:'Systran/faster-whisper-medium'},config=asrConfiguration(env);
 const sourceStore=new FileStore(source.sourceRoot),prefix=`projects/${source.sourceProjectId}`,before=(await sourceStore.readFresh(prefix+'/control')).value,budget=(await sourceStore.readFresh(prefix+'/budget')).value;
 const store=new FileStore(root),journal={store,prefix:`projects/${randomUUID()}/operations/${randomUUID()}/media-effects`};
 let networkCalls=0;globalThis.fetch=async()=>{networkCalls++;throw Error('ASR_RUNTIME_NETWORK_FORBIDDEN')};
 const report:{executedAt:string;status:string;root:string;runtime:typeof config;journalPrefix:string;sourcePlanHash:string;lines:unknown[];networkCalls:number;sourceUnchanged?:boolean;receipts?:unknown[];errorCode?:string;limits:string}={executedAt:new Date().toISOString(),status:'running',root,runtime:config,journalPrefix:journal.prefix,sourcePlanHash:source.sourcePlanHash,lines:[],networkCalls:0,limits:'Six original SHA-verified WAV copies through actual production transcribeAudio and verifySpokenText with the explicitly pinned medium image, one owned completed producer per line and mustExist cold replay. No synthesis, expected rewrite, source project mutation or remote model call. Whole-context zero-length timing failure remains archived. This is not AAC/postmix, listening, full preview or 43-style QA.'};
 async function record(){report.networkCalls=networkCalls;await writeFile('docs/engineering/evidence/asr-medium-runtime-probe.json',JSON.stringify(report,null,2)+'\n')}
 try{
  await record();let failed=false;
  for(const line of source.lines){
   const original=await inspectVoiceWav(line.outputPath);if(original.sha256!==line.wav.sha256)throw Error('SOURCE_CHANGED');
   const directory=join(root,'voice',line.lineId);await mkdir(directory,{recursive:true,mode:0o700});const outputPath=join(directory,'narration.wav');await copyFile(line.outputPath,outputPath);
   const wav=await inspectVoiceWav(outputPath);if(wav.sha256!==original.sha256)throw Error('SOURCE_CHANGED');
   const language=line.lineId==='frontend_english'?'en' as const:'zh-CN' as const;
   const voice={language,outputPath,wav},transcript=await transcribeAudio(root,voice,'voice',env,{journal});
   const replay=await transcribeAudio(root,voice,'voice',env,{mustExist:true,journal:{...journal,store:new FileStore(root)}});
   if(canonicalHash(replay)!==canonicalHash(transcript))throw Error('ASR_STAGE_UNKNOWN');
   let status='pass',errorCode;
   try{verifySpokenText(line.expectedAsrText,line.expectedAsrText,transcript)}catch(error){status='fail';failed=true;errorCode=error instanceof Error?error.message:'ASR_VERIFICATION_FAILED'}
   report.lines.push({lineId:line.lineId,expectedAsrText:line.expectedAsrText,originalPath:line.outputPath,outputPath,wav,transcript,coldReplayIdentical:true,status,...(errorCode?{errorCode}:{})});await record();console.log(JSON.stringify({lineId:line.lineId,status,errorCode}));
  }
  report.status=failed?'blocked':'pass';if(failed)process.exitCode=1;
 }catch(error){report.status='blocked';report.errorCode=error instanceof Error?error.message:'MEDIUM_RUNTIME_FAILED';process.exitCode=1}
 finally{
  report.sourceUnchanged=canonicalHash((await sourceStore.readFresh(prefix+'/control')).value)===canonicalHash(before)&&canonicalHash((await sourceStore.readFresh(prefix+'/budget')).value)===canonicalHash(budget);
  if(!report.sourceUnchanged||networkCalls){report.status='blocked';report.errorCode='SOURCE_CHANGED';process.exitCode=1}
  await record();report.receipts=await Promise.all((await store.listKeys(journal.prefix,1)).map(async key=>(await store.readFresh(key)).value));await record();console.log(JSON.stringify({status:report.status,errorCode:report.errorCode,root,networkCalls}));
 }
}
main().catch(error=>{console.error(JSON.stringify({status:'fail',errorCode:error.message}));process.exitCode=1});
