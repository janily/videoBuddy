import {randomUUID} from 'node:crypto';
import {readFile,writeFile,realpath} from 'node:fs/promises';
import {relative,resolve,isAbsolute} from 'node:path';
import type {ProjectControl} from '../../src/contracts/video/project';
import type {ObjectRef} from '../../src/contracts/video/domain';
import {FileStore} from '../../src/services/video/storage/file-store';
import {ProjectStore} from '../../src/services/video/storage/project-store';
import {updateJson} from '../../src/services/video/storage/atomic-store';
import {prepareAudioPlanStage} from '../../src/services/video/preview/audio-plan-stage';
import {probeEnvironment,recordModelRequests} from './helpers/real-probe';
// New explicitly invoked one-call experiment after exposing precise event constraints.
// The old uncertain paid effect and its reservation remain; never delete or retry its key.
async function main(){
 if(!process.argv.includes('--repair-audio'))throw Error('AUDIO_REPAIR_PROBE_OPT_IN_REQUIRED');
 const source=JSON.parse(await readFile('docs/engineering/evidence/real-creation-no-voice-probe.json','utf8'));
 const root=await realpath(source.root),rel=relative(await realpath(resolve('.video-local/real-creation')),root);
 if(!rel||rel.startsWith('..')||isAbsolute(rel)||source.errorCode!=='AUDIO_EVENT_INVALID')throw Error('AUDIO_REPAIR_BASELINE_REQUIRED');
 const {projectId,revisionId,operationId:priorOperationId}=source.stages.project,projects=new ProjectStore(new FileStore(root)),operationId=randomUUID(),env=probeEnvironment(root),treatmentRef=source.stages.treatment.treatmentRef as ObjectRef;
 env.VIDEO_PROJECT_MAX_MODEL_CALLS='7';env.VIDEO_DAILY_MAX_MODEL_CALLS='7';
 const auditRef=await projects.index.immutable('projects/'+projectId+'/revisions/'+revisionId+'/audio-repair-intent',{schemaVersion:1,priorOperationId,operationId,reason:'new one-call experiment with explicit sample/envelope/source constraints',maxAdditionalHttpCalls:1,projectAggregateCallLimit:7});
 await updateJson(projects.store,'projects/'+projectId+'/control',(c:ProjectControl)=>{if(c.activeProduction!==priorOperationId||c.phase!=='preparing_preview'||c.inputPending)throw Error('AUDIO_REPAIR_STALE');return{...c,activeProduction:operationId,controlVersion:c.controlVersion+1}});
 const recorder=recordModelRequests(env,root,1),evidence:{executedAt:string;root:string;projectId:string;revisionId:string;operationId:string;auditRef:ObjectRef;requests:typeof recorder.requests;status:string;record?:unknown;plan?:unknown;errorCode?:string;limits:string}={executedAt:new Date().toISOString(),root,projectId,revisionId,operationId,auditRef,requests:recorder.requests,status:'running',limits:'Manual isolated one-call Audio experiment after explicit event constraints; prior failed paid effect/reservation retained. Project aggregate limit seven calls. Actual output caps remain unenforced; no semantic/listening QA, approval or publication.'};
 try{const record=await prepareAudioPlanStage(projects,projectId,revisionId,operationId,0,treatmentRef,{root,env});evidence.record=record;evidence.plan=(await projects.store.readFresh(record.planRef.key)).value;evidence.status='pass'}
 catch(error){evidence.status='blocked';evidence.errorCode=String(error instanceof Error?error.message:'AUDIO_REPAIR_FAILED').replaceAll(env.MODEL_API_KEY||'missing-key','[redacted]').slice(0,300);process.exitCode=1}
 finally{recorder.restore();await recorder.flush();await updateJson(projects.store,'projects/'+projectId+'/control',(c:ProjectControl)=>{if(c.activeProduction!==operationId||c.phase!=='preparing_preview'||c.inputPending)throw Error('AUDIO_REPAIR_STALE');return{...c,activeProduction:priorOperationId,controlVersion:c.controlVersion+1}});await writeFile('docs/engineering/evidence/real-audio-repair-probe.json',JSON.stringify(evidence,null,2)+'\n');console.log(JSON.stringify({status:evidence.status,requests:recorder.requests,errorCode:evidence.errorCode}))}
}
main().catch(error=>{console.error(JSON.stringify({status:'fail',errorName:error?.name||'Error',errorCode:String(error?.message||'AUDIO_REPAIR_FAILED').replaceAll(process.env.MODEL_API_KEY||'missing-key','[redacted]').slice(0,300)}));process.exitCode=1});
