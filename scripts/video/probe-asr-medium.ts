import {createHash,randomUUID} from 'node:crypto';
import {mkdir,mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {z} from 'zod';
import {FileStore} from '../../src/services/video/storage/file-store';
import {canonicalHash} from '../../src/services/video/domain/hash';
import {inspectVoiceWav} from '../../src/services/video/audio/wav';
import {asrConfiguration} from '../../src/services/video/audio/asr';
import {assertAsrExpected} from '../../src/services/video/timeline/compile';
import {runOwnedDocker} from '../../src/services/video/media/owned-docker';
import {probeEnvironment} from './helpers/real-probe';

const word=z.strictObject({text:z.string().min(1),startMs:z.number().int().nonnegative(),endMs:z.number().int().nonnegative(),probability:z.number().min(0).max(1)});
const output=z.strictObject({model:z.literal('Systran/faster-whisper-medium'),revision:z.literal('08e178d48790749d25932bbc082711ddcfdfbc4f'),modelWeightsSha256:z.literal('9b45e1009dcc4ab601eff815b61d80e60ce3fd8c74c1a14f4a282258286b51ae'),language:z.literal('zh-CN'),segments:z.array(z.strictObject({text:z.string().min(1),startMs:z.number().int().nonnegative(),endMs:z.number().int().nonnegative(),words:z.array(word).min(1)})).min(1).max(100)});
async function main(){
 if(!process.argv.includes('--asr-medium'))throw Error('MEDIUM_ASR_OPT_IN_REQUIRED');
 const models=resolve('.video-local/asr-medium/model'),manifest=JSON.parse(await readFile('.video-local/asr-medium/manifest.json','utf8'));
 if(manifest.status!=='verified'||manifest.repository!=='Systran/faster-whisper-medium'||manifest.revision!=='08e178d48790749d25932bbc082711ddcfdfbc4f'||manifest.files['model.bin'].sha256!=='9b45e1009dcc4ab601eff815b61d80e60ce3fd8c74c1a14f4a282258286b51ae')throw Error('MEDIUM_MODEL_NOT_VERIFIED');
 const voice=JSON.parse(await readFile('docs/engineering/evidence/voice-front-end-probe.json','utf8')),context=JSON.parse(await readFile('docs/engineering/evidence/asr-context-probe.json','utf8')),line=voice.lines.find((candidate:{lineId:string})=>candidate.lineId==='line_3');
 const cases=[{id:'original_line_3',path:line.outputPath,sha256:line.wav.sha256,expected:line.expectedAsrText},{id:'unchanged_full_context',path:join(context.root,'source/context.wav'),sha256:context.stages.pcm.wav.sha256,expected:context.stages.expectedAsrText}];
 const parent=resolve('.video-local/asr-medium-inference');await mkdir(parent,{recursive:true,mode:0o700});const root=await mkdtemp(join(parent,'probe-')),config=asrConfiguration(probeEnvironment(root)),store=new FileStore(root),journal={store,prefix:`projects/${randomUUID()}/operations/${randomUUID()}/media-effects`};
 const code=await readFile('runtime/asr/diagnostics/medium-transcribe.py'),codePath=join(root,'medium-transcribe.py');await writeFile(codePath,code,{mode:0o600,flag:'wx'});
 const sourceStore=new FileStore(voice.sourceRoot),sourcePrefix=`projects/${voice.sourceProjectId}`,before=(await sourceStore.readFresh(sourcePrefix+'/control')).value,budget=(await sourceStore.readFresh(sourcePrefix+'/budget')).value;
 let networkCalls=0;globalThis.fetch=async()=>{networkCalls++;throw Error('MEDIUM_ASR_NETWORK_FORBIDDEN')};
 const report:{executedAt:string;status:string;root:string;modelManifest:unknown;runtimeImage:string;scriptSha256:string;journalPrefix:string;networkCalls:number;cases:unknown[];sourceUnchanged?:boolean;errorCode?:string;receipts?:unknown[];limits:string}={executedAt:new Date().toISOString(),status:'running',root,modelManifest:manifest,runtimeImage:config.image,scriptSha256:createHash('sha256').update(code).digest('hex'),journalPrefix:journal.prefix,networkCalls:0,cases:[],limits:'Actual independent CPU int8 medium-model diagnostic using pinned engine image plus SHA-verified model files and frozen script. Original rejected single-line and unchanged full-context WAV; no expected/initial_prompt supplied to recognizer, no TTS/model API call or automatic retry. This does not integrate or promote a production ASR runtime, override small-model failure, validate other lines or publish a preview.'};
 async function record(){report.networkCalls=networkCalls;await writeFile('docs/engineering/evidence/asr-medium-probe.json',JSON.stringify(report,null,2)+'\n')}
 try{
  await record();let failed=false;
  for(const scenario of cases){
   const wav=await inspectVoiceWav(scenario.path);if(wav.sha256!==scenario.sha256)throw Error('SOURCE_CHANGED');
   const jobPath=join(root,scenario.id+'.json');await writeFile(jobPath,JSON.stringify({language:'zh-CN'}),{mode:0o600,flag:'wx'});
   const args=['run','--rm','--network','none','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges','--pids-limit','128','--cpus','4','--memory','6g','--memory-swap','6g','--user',config.user,'--tmpfs','/tmp:rw,nosuid,size=128m','--mount',`type=bind,src=${jobPath},dst=/work/job.json,readonly`,'--mount',`type=bind,src=${scenario.path},dst=/input/voice.wav,readonly`,'--mount',`type=bind,src=${models},dst=/diagnostics/model,readonly`,'--mount',`type=bind,src=${codePath},dst=/diagnostics/transcribe.py,readonly`,config.image,'python3','/diagnostics/transcribe.py','/work/job.json'];
   const started=Date.now(),raw=await runOwnedDocker(args,300000,config.image,undefined,journal),transcript=output.parse(JSON.parse(raw)),recognized=transcript.segments.map(segment=>segment.text).join(''),words=transcript.segments.flatMap(segment=>segment.words);
   let status='pass',errorCode;
   try{assertAsrExpected(scenario.expected,scenario.expected,recognized);if(words.some((item,index)=>item.endMs<=item.startMs||item.endMs>wav.durationMs+1000||index>0&&item.startMs<words[index-1].endMs))throw Error('ASR_TIMINGS_UNAVAILABLE')}catch(error){status='fail';failed=true;errorCode=error instanceof Error?error.message:'ASR_VERIFICATION_FAILED'}
   report.cases.push({id:scenario.id,expectedAsrText:scenario.expected,recognizedText:recognized,sourceWav:wav,transcript,elapsedMs:Date.now()-started,status,...(errorCode?{errorCode}:{})});await record();console.log(JSON.stringify({id:scenario.id,status,errorCode}));
  }
  report.status=failed?'blocked':'pass';if(failed)process.exitCode=1;
 }catch(error){report.status='blocked';report.errorCode=error instanceof Error?error.message:'MEDIUM_ASR_FAILED';process.exitCode=1}
 finally{
  report.sourceUnchanged=canonicalHash((await sourceStore.readFresh(sourcePrefix+'/control')).value)===canonicalHash(before)&&canonicalHash((await sourceStore.readFresh(sourcePrefix+'/budget')).value)===canonicalHash(budget);
  if(!report.sourceUnchanged||networkCalls||createHash('sha256').update(await readFile(codePath)).digest('hex')!==report.scriptSha256){report.status='blocked';report.errorCode='SOURCE_CHANGED';process.exitCode=1}
  await record();report.receipts=await Promise.all((await store.listKeys(journal.prefix,1)).map(async key=>(await store.readFresh(key)).value));await record();console.log(JSON.stringify({status:report.status,errorCode:report.errorCode,root,networkCalls}));
 }
}
main().catch(error=>{console.error(JSON.stringify({status:'fail',errorCode:error.message}));process.exitCode=1});
