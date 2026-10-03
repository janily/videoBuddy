import {randomUUID} from 'node:crypto';
import {mkdir,mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {dirname,join,resolve} from 'node:path';
import {FileStore} from '../../src/services/video/storage/file-store';
import type {ProjectControl} from '../../src/contracts/video/project';
import type {Understanding} from '../../src/contracts/video/domain';
import {canonicalHash} from '../../src/services/video/domain/hash';
import {compileVoicePlan} from '../../src/services/video/preview/voice-plan';
import {inspectVoiceWav} from '../../src/services/video/audio/wav';
import {transcribeAudio,verifySpokenText} from '../../src/services/video/audio/asr';
import {runOwnedDocker} from '../../src/services/video/media/owned-docker';
import {assertDockerCacheReusable} from '../../src/services/video/media/docker-journal';
import {dockerConfiguration} from '../../src/services/video/media/docker-executor';
import {probeEnvironment} from './helpers/real-probe';

function pcm(bytes:Buffer){
 for(let offset=12;offset+8<=bytes.length;){const length=bytes.readUInt32LE(offset+4);if(bytes.toString('ascii',offset,offset+4)==='data')return bytes.subarray(offset+8,offset+8+length);offset+=8+length+(length%2)}
 throw Error('PCM_DATA_MISSING');
}
async function main(){
 if(!process.argv.includes('--asr-context'))throw Error('ASR_CONTEXT_OPT_IN_REQUIRED');
 const recovery=process.argv.includes('--recover-report')?JSON.parse(await readFile('docs/engineering/evidence/asr-context-probe.json','utf8')):undefined;
 const source=JSON.parse(await readFile('docs/engineering/evidence/voice-front-end-probe.json','utf8')),store=new FileStore(source.sourceRoot),prefix=`projects/${source.sourceProjectId}`;
 const before=(await store.readFresh<ProjectControl>(prefix+'/control')).value,budget=(await store.readFresh(prefix+'/budget')).value;
 const understanding=(await store.readFresh<Understanding>(before.understandingRef.key)).value;if(canonicalHash(understanding)!==before.understandingRef.sha256)throw Error('SOURCE_CHANGED');
 const original=JSON.parse(await readFile(join(source.sourceRoot,'new-theme-evidence.json'),'utf8'));
 const keys=await store.listKeys(`${prefix}/revisions/${original.stages.operation.revisionId}/treatment-plan`,1);if(keys.length!==1)throw Error('TREATMENT_SOURCE_REQUIRED');
 const treatment=(await store.readFresh(keys[0])).value;if(!keys[0].endsWith('/'+canonicalHash(treatment)))throw Error('SOURCE_CHANGED');
 const plan=compileVoicePlan(treatment,understanding);if(canonicalHash(plan)!==source.sourcePlanHash)throw Error('SOURCE_CHANGED');
 const parent=resolve('.video-local/asr-context');await mkdir(parent,{recursive:true,mode:0o700});const root=recovery?.root??await mkdtemp(join(parent,'probe-')),outputDir=join(root,'source');if(!recovery)await mkdir(outputDir,{mode:0o700});
 const env=probeEnvironment(root),media=dockerConfiguration(env,'audio-mix'),journal={store:new FileStore(root),prefix:recovery?.journalPrefix??`projects/${randomUUID()}/operations/${randomUUID()}/media-effects`};
 if(recovery&&recovery.sourcePlanHash!==canonicalHash(plan))throw Error('SOURCE_CHANGED');
 const inputs:Array<{lineId:string;path:string;startMs:number;data:Buffer}>=[];
 for(const line of plan.lines){
  const saved=source.lines.find((candidate:{lineId:string;scenario:string})=>candidate.lineId===line.lineId&&candidate.scenario==='frozen_new_theme');
  if(!saved||line.language!=='zh-CN'||saved.spokenText!==line.spokenText||saved.expectedAsrText!==line.expectedAsrText)throw Error('SOURCE_CHANGED');
  const wav=await inspectVoiceWav(saved.outputPath),job=JSON.parse(await readFile(join(dirname(dirname(saved.outputPath)),'job.json'),'utf8'));
  if(wav.sha256!==saved.wav.sha256||wav.durationMs>line.reservedMs||job.text!==line.spokenText||job.lineId!==line.lineId||job.language!==line.language)throw Error('SOURCE_CHANGED');
  inputs.push({lineId:line.lineId,path:saved.outputPath,startMs:line.startMs,data:pcm(await readFile(saved.outputPath))});
 }
 let networkCalls=0;globalThis.fetch=async()=>{networkCalls++;throw Error('ASR_CONTEXT_NETWORK_FORBIDDEN')};
 const report:{status:string;root:string;sourcePlanHash:string;journalPrefix:string;networkCalls:number;stages:Record<string,unknown>;errorCode?:string;limits:string}={status:'running',root,sourcePlanHash:canonicalHash(plan),journalPrefix:journal.prefix,networkCalls:0,stages:{...(recovery?.stages??{}),expectedAsrText:plan.lines.map(line=>line.expectedAsrText).join(' ')},limits:'Independent full-context ASR diagnostic using unchanged frozen narration PCM at original positions; no initial_prompt or expected transcript provided to recognizer. Does not override failed individual checks, validate per-line timing or publish a preview. Original control/budget and failure reports remain unchanged.'};
 async function record(){report.networkCalls=networkCalls;await writeFile('docs/engineering/evidence/asr-context-probe.json',JSON.stringify(report,null,2)+'\n')}
 try{
  await record();const args=['run','--rm','--network','none','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges','--pids-limit','64','--cpus','2','--memory','1g','--memory-swap','1g','--user',media.user,'--tmpfs','/tmp:rw,nosuid,size=64m'];
  inputs.forEach((input,index)=>args.push('--mount',`type=bind,src=${input.path},dst=/input/${index}.wav,readonly`));args.push('--mount',`type=bind,src=${outputDir},dst=/output`,media.image,'ffmpeg','-hide_banner','-loglevel','error','-nostdin','-y','-f','lavfi','-t',String(plan.durationMs/1000),'-i','anullsrc=r=24000:cl=mono');
  inputs.forEach((_,index)=>args.push('-i',`/input/${index}.wav`));
  const filter=inputs.map((input,index)=>`[${index+1}:a]adelay=${input.startMs*24}S[v${index}]`).concat(`[0:a]${inputs.map((_,index)=>`[v${index}]`).join('')}amix=inputs=${inputs.length+1}:duration=first:normalize=0[out]`).join(';');
  args.push('-filter_complex',filter,'-map','[out]','-c:a','pcm_f32le','-ar','24000','-ac','1','/output/context.wav');
  if(recovery){if(!await assertDockerCacheReusable(journal,args,media.image))throw Error('MEDIA_RECEIPT_MISSING')}
  else await runOwnedDocker(args,120000,media.image,undefined,journal);
  const outputPath=join(outputDir,'context.wav'),wav=await inspectVoiceWav(outputPath),data=pcm(await readFile(outputPath));
  if(recovery&&wav.sha256!==recovery.stages.pcm.wav.sha256||wav.durationMs!==plan.durationMs||inputs.some(input=>!data.subarray(input.startMs*24*4,input.startMs*24*4+input.data.length).equals(input.data)))throw Error('PCM_SOURCE_CHANGED');
  report.stages.pcm={wav,originalWindowsExactlyEqual:true};await record();
  const transcript=await transcribeAudio(root,{language:'zh-CN',outputPath,wav},'source',env,{journal,mustExist:Boolean(recovery)});report.stages.transcript=transcript;await record();
  verifySpokenText(String(report.stages.expectedAsrText),String(report.stages.expectedAsrText),transcript);report.status='pass';
 }catch(error){report.status='blocked';report.errorCode=error instanceof Error?error.message:'ASR_CONTEXT_FAILED';process.exitCode=1}
 finally{
  const unchanged=canonicalHash((await store.readFresh(prefix+'/control')).value)===canonicalHash(before)&&canonicalHash((await store.readFresh(prefix+'/budget')).value)===canonicalHash(budget);
  report.stages.sourceControlAndBudgetUnchanged=unchanged;
  if(!unchanged||networkCalls){report.status='blocked';report.errorCode='SOURCE_CHANGED';process.exitCode=1}
  await record();report.stages.receipts=await Promise.all((await journal.store.listKeys(journal.prefix,1)).map(async key=>(await journal.store.readFresh(key)).value));report.stages.readOnlyReportRecovery=Boolean(recovery);await record();console.log(JSON.stringify({status:report.status,errorCode:report.errorCode,root,networkCalls}));
 }
}
main().catch(error=>{console.error(JSON.stringify({status:'fail',errorCode:error.message}));process.exitCode=1});
