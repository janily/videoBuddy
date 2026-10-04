import {randomUUID} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import type {Understanding} from '../../src/contracts/video/domain';
import {canonicalHash} from '../../src/services/video/domain/hash';
import {FileStore} from '../../src/services/video/storage/file-store';
import {ProjectStore} from '../../src/services/video/storage/project-store';
import {compileVoicePlan} from '../../src/services/video/preview/voice-plan';
import {prepareNarration} from '../../src/services/video/audio/narration';
import {synthesizeVoice} from '../../src/services/video/audio/voice';
import {transcribeAudio,verifyNarration} from '../../src/services/video/audio/asr';
import {findConfirmedSpeechReview} from '../../src/services/video/audio/spoken-review';
import {archiveVerifiedNarration,loadPackagedNarration} from '../../src/services/video/audio/narration-package';

const reportPath='docs/engineering/evidence/new-theme-reviewed-narration-v2-probe.json';
async function main(){
 if(!process.argv.includes('--reviewed-narration'))throw Error('EXPLICIT_PROBE_REQUIRED');
 const mustExist=process.argv.includes('--mustExist'),source=JSON.parse(await readFile('docs/engineering/evidence/new-theme-upgraded-probe.json','utf8')),answer=JSON.parse(await readFile('docs/engineering/evidence/new-theme-spoken-review-confirmation.json','utf8'));
 let prior;try{prior=JSON.parse(await readFile(reportPath,'utf8'))}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error}
 if(prior&&!mustExist)throw Error('PROBE_ALREADY_RECORDED_USE_MUST_EXIST');
 if(mustExist&&!prior)throw Error('PROBE_EVIDENCE_MISSING');
 const store=new FileStore(source.root),projects=new ProjectStore(store),prefix=`projects/${source.projectId}`,before=await projects.access('new-theme-validation',source.projectId),opKey=prefix+'/operations/'+answer.sourceOperationId;
 const operation=(await store.readFresh(opKey)).value,budget=(await store.readFresh(prefix+'/budget')).value;
 if(canonicalHash(operation)!==canonicalHash(source.stages.operation))throw Error('SOURCE_OPERATION_CHANGED');
 const understanding=(await store.readFresh<Understanding>(before.understandingRef.key)).value;
 if(canonicalHash(understanding)!==before.understandingRef.sha256)throw Error('SOURCE_UNDERSTANDING_CHANGED');
 const keys=await store.listKeys(prefix+'/revisions/'+answer.sourceRevisionId+'/treatment-plan',1);if(keys.length!==1)throw Error('TREATMENT_CHANGED');
 const treatment=(await store.readFresh(keys[0])).value;if(!keys[0].endsWith('/'+canonicalHash(treatment)))throw Error('TREATMENT_CHANGED');
 const plan=compileVoicePlan(treatment,understanding),revisionId=prior?.diagnosticRevisionId||randomUUID(),journal={store,prefix:prefix+'/operations/'+revisionId+'/media-effects'};
 const env={VIDEO_VOICE_IMAGE_REF:'sha256:'+answer.voiceRuntimeDigest,VIDEO_VOICE_RUNTIME_DIGEST:answer.voiceRuntimeDigest,VIDEO_ASR_IMAGE_REF:'sha256:'+answer.asrRuntimeDigest,VIDEO_ASR_RUNTIME_DIGEST:answer.asrRuntimeDigest,VIDEO_ASR_MODEL:'Systran/faster-whisper-medium'};
 let networkCalls=0;globalThis.fetch=async()=>{networkCalls++;throw Error('NETWORK_FORBIDDEN')};
 const report:Record<string,unknown>={executedAt:new Date().toISOString(),status:'started',root:source.root,projectId:source.projectId,sourceOperationId:answer.sourceOperationId,sourceRevisionId:answer.sourceRevisionId,diagnosticRevisionId:revisionId,planSha256:canonicalHash(plan),journalPrefix:journal.prefix,mustExist};
 if(!mustExist)await writeFile(reportPath,JSON.stringify(report,null,2)+'\n');
 try{
  const prepared=await prepareNarration(plan,source.root,(root,job)=>synthesizeVoice(root,job,env,{mustExist:true}));
  const verified=await verifyNarration(plan,prepared,source.root,(root,voice)=>transcribeAudio(root,voice,'voice',env,{mustExist,journal}),async(line,voice,transcript)=>findConfirmedSpeechReview(store,source.projectId,plan,line,voice,transcript));
  report.verified=verified;
  const timing=verified.lines.map(line=>({lineId:line.lineId,spokenText:line.spokenText,displayText:line.displayText,expectedAsrText:line.expectedAsrText,startSample:line.startMs*48,endSample:line.startMs*48+line.voice.wav.samples*2,voiceSha256:line.voice.wav.sha256,voiceRuntimeDigest:line.voice.runtimeDigest,asrRuntimeDigest:line.asr.runtimeDigest}));
  const packaged=await archiveVerifiedNarration(projects,source.root,source.projectId,revisionId,verified,timing);
  for(const entry of packaged.sources)await loadPackagedNarration(new FileStore(source.root),source.root,source.projectId,revisionId,entry.sourceRef);
  report.packaged=packaged;report.status='source_narration_verified';
 }catch(error){report.status='failed';report.errorCode=(error as Error).message;process.exitCode=1}
 const after=await projects.access('new-theme-validation',source.projectId);
 report.networkCalls=networkCalls;report.sourceOperationAndBudgetUnchanged=canonicalHash((await store.readFresh(opKey)).value)===canonicalHash(operation)&&canonicalHash((await store.readFresh(prefix+'/budget')).value)===canonicalHash(budget);
 report.sourceControlUnchanged=canonicalHash(after)===canonicalHash(before);
 report.limits='Independent source-WAV check and cold packaging only. One explicit human review applies to line_2 only. Original failed preview operation remains failed. No Treatment/Director rerun, TTS synthesis, final mix, picture, Critic, preview or formal approval.';
 if(!report.sourceOperationAndBudgetUnchanged||!report.sourceControlUnchanged||networkCalls)throw Error('SOURCE_STATE_CHANGED');
 await writeFile(mustExist?reportPath.replace('.json','-recovery.json'):reportPath,JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify({status:report.status,errorCode:report.errorCode,diagnosticRevisionId:revisionId,networkCalls}));
}
main().catch(error=>{console.error(JSON.stringify({status:'failed',errorCode:error.message}));process.exitCode=1});
