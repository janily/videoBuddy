import type {ObjectRef} from '../../src/contracts/video/domain';
import {readNarrationJson} from '../../src/services/video/audio/narration-package';
import {createHash} from 'node:crypto';
import {readFile,copyFile,constants} from 'node:fs/promises';
import {join} from 'node:path';
import {FileStore} from '../../src/services/video/storage/file-store';
import {canonicalHash} from '../../src/services/video/domain/hash';
import {inspectVoiceWav} from '../../src/services/video/audio/wav';
import {transcribeAudio,verifySpokenText,type VerifiedNarrationManifest} from '../../src/services/video/audio/asr';
import type {NarrationPlan} from '../../src/services/video/audio/narration';
import {claimProbeReport,persistProbeReport} from './helpers/probe-report';
async function main(){
 if(!process.argv.includes('--read-existing-postmix'))throw Error('EXPLICIT_READ_ONLY_PROBE_REQUIRED');
 const evidence=JSON.parse(await readFile('docs/engineering/evidence/new-theme-accounted-audio-preview-probe.json','utf8')),op=evidence.stages.operation;
 if(evidence.status!=='blocked'||op.status!=='failed'||op.stage!=='composition')throw Error('TERMINAL_COMPOSITION_FAILURE_REQUIRED');
 const store=new FileStore(evidence.root),prefix=`projects/${op.projectId}`,voice=(await store.readFresh<{planRef:ObjectRef;verifiedRef:ObjectRef}>(prefix+'/revisions/'+op.revisionId+'/voice-stage')).value;
 if(canonicalHash(voice)!==canonicalHash(evidence.stages.stageRecords['voice-stage']))throw Error('VOICE_STAGE_CHANGED');
 const revisionPrefix=prefix+'/revisions/'+op.revisionId+'/',plan=await readNarrationJson(store,voice.planRef,revisionPrefix) as NarrationPlan,verified=await readNarrationJson(store,voice.verifiedRef,revisionPrefix) as VerifiedNarrationManifest;
 const preservedKeys=[prefix+'/control',prefix+'/budget',prefix+'/operations/'+op.id],before=await Promise.all(preservedKeys.map(async key=>canonicalHash((await store.readFresh(key)).value)));
 const filmPath=join(evidence.root,'composition','429a90ff9afeef2ee7a92eb76bef4b1c2006eb1b53e0adcb1cd0c8e43f5d27f2','output','final.mp4'),filmSha256=createHash('sha256').update(await readFile(filmPath)).digest('hex');
 const runtimeDigest='75ffd41e03d738cee7e10914aeaeb2605b9daf213409afec295ccb97bb06c919',asrRuntimeDigest='caa3fca3e3e6866dab7351346367768db612bb411f06fbd4a7a44f767747f5d4',path='docs/engineering/evidence/accounted-preview-postmix-probe.json',report:{[key:string]:unknown}={executedAt:new Date().toISOString(),root:evidence.root,projectId:op.projectId,operationId:op.id,revisionId:op.revisionId,filmPath,filmSha256,status:'started',technicalProbeOnly:true,deliveryEligible:false,lines:[]};
 await claimProbeReport(path,report);const rows:unknown[]=[],ordered=[...verified.lines].sort((a,b)=>a.startMs-b.startMs),env={VIDEO_ASR_IMAGE_REF:'sha256:'+asrRuntimeDigest,VIDEO_ASR_RUNTIME_DIGEST:asrRuntimeDigest,VIDEO_ASR_MODEL:'Systran/faster-whisper-medium'};
 try{for(const [index,line] of ordered.entries()){
 const lengthMs=Math.min(line.durationMs+300,(ordered[index+1]?.startMs??plan.durationMs)-line.startMs,plan.durationMs-line.startMs),key=createHash('sha256').update(JSON.stringify([filmSha256,line.lineId,line.language,line.startMs,lengthMs,runtimeDigest,'postmix-v1'])).digest('hex'),outputPath=join(evidence.root,'postmix',key,'output','line.wav');
 let wav;try{wav=await inspectVoiceWav(outputPath)}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;rows.push({lineId:line.lineId,status:'not_reached'});continue}
 const transcript=await transcribeAudio(evidence.root,{language:line.language,outputPath,wav},'postmix',env,{mustExist:true});
 let status:string;try{verifySpokenText(line.expectedAsrText,line.expectedAsrText,transcript);status='pass'}catch(error){status=(error as Error).message}
 rows.push({lineId:line.lineId,expectedText:line.expectedAsrText,status,outputPath,wav,transcript});
 if(status==='ASR_MISMATCH'){const playback='docs/engineering/evidence/new-theme-postmix-spoken-review.wav';await copyFile(outputPath,playback,constants.COPYFILE_EXCL);report.listeningAudioPath=playback;report.listeningFileSha256=createHash('sha256').update(await readFile(playback)).digest('hex')}
 }report.status='existing_evidence_read'}catch(error){report.status='blocked';report.errorCode=(error as Error).message;process.exitCode=1}
 report.lines=rows;report.sourceStateUnchanged=canonicalHash(before)===canonicalHash(await Promise.all(preservedKeys.map(async key=>canonicalHash((await store.readFresh(key)).value))));await persistProbeReport(path,report);console.log(JSON.stringify({status:report.status,lines:rows.map(row=>{const r=row as {lineId:string;expectedText:string;status:string;transcript?:{recognizedText:string}};return{lineId:r.lineId,status:r.status,expectedText:r.expectedText,recognizedText:r.transcript?.recognizedText}}),sourceStateUnchanged:report.sourceStateUnchanged}));
}
main().catch(error=>{console.error(JSON.stringify({status:'blocked',errorCode:error.message}));process.exitCode=1});
