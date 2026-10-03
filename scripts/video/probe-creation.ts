import {randomUUID} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {UnderstandingSchema} from '../../src/contracts/video/domain';
import type {ProjectControl} from '../../src/contracts/video/project';
import {FileStore} from '../../src/services/video/storage/file-store';
import {ProjectStore} from '../../src/services/video/storage/project-store';
import {updateJson} from '../../src/services/video/storage/atomic-store';
import {prepareTreatmentStage} from '../../src/services/video/preview/treatment-stage';
import {prepareVoiceStage} from '../../src/services/video/preview/voice-stage';
import {prepareTimingStage} from '../../src/services/video/preview/timing-stage';
import {prepareAudioPlanStage} from '../../src/services/video/preview/audio-plan-stage';
import {prepareVisualShotStage} from '../../src/services/video/preview/visual-stage';
import type {TreatmentPlan} from '../../src/contracts/video/treatment';
import {applyUnderstandingPatch} from '../../src/mastra/video/director';
import {probeEnvironment,recordModelRequests} from './helpers/real-probe';

// One bounded real creative pipeline. Failure retains its isolated work directory and paid effect records.
async function main(){
 if(!process.argv.includes('--real'))throw Error('REAL_MODEL_PROBE_OPT_IN_REQUIRED');
 const source=JSON.parse(await readFile('docs/engineering/evidence/real-director-probe.json','utf8'));let understanding=UnderstandingSchema.parse(source.understanding);
 const withoutVoice=process.argv.includes('--without-voice'),evidenceName=withoutVoice?'real-creation-no-voice-probe.json':'real-creation-probe.json';
 if(withoutVoice){const id=randomUUID();understanding=applyUnderstandingPatch(understanding,{baseBriefVersion:understanding.briefVersion,operations:[{op:'set_preference',field:'voiceMode',value:'none',sourceMessageIds:[id]}]},[{id,role:'user',text:'本独立技术测试明确不要旁白，继续原创配乐；不改变之前的有声测试项目。'}])}
 const root=resolve('.video-local','real-creation',randomUUID());await mkdir(root,{recursive:true,mode:0o700});
 const env=probeEnvironment(root),recorder=recordModelRequests(env,root,6),requests=recorder.requests;
 const evidence:{executedAt:string;model:string|undefined;root:string;stages:Record<string,unknown>;requests:typeof requests;status:string;errorCode?:string;limits:string}={executedAt:new Date().toISOString(),model:env.VIDEO_DIRECTOR_MODEL,root,stages:{},requests,status:'running',limits:(withoutVoice?'Separate explicitly no-voice test variant; previous spoken-name failure remains blocked. ':'')+'Opt-in isolated local real-model pipeline, maximum six HTTP calls and no automatic retries. Provider ignores output caps; requests and observed usage are recorded, no claim of hard token bounds, semantic/style/listening QA or approved final movie.'};
 async function record(){await recorder.flush();await writeFile('docs/engineering/evidence/'+evidenceName,JSON.stringify(evidence,null,2)+'\n')}
 try{
  const projects=new ProjectStore(new FileStore(root)),{projectId}=await projects.create('real-probe-owner',{schemaVersion:5,clientCommandId:randomUUID(),clientCreateId:randomUUID()}),revisionId=randomUUID(),operationId=randomUUID();
  const understandingRef=await projects.index.immutable('projects/'+projectId+'/understanding/'+understanding.briefVersion,understanding);
  await updateJson(projects.store,'projects/'+projectId+'/control',(c:ProjectControl)=>({...c,briefVersion:understanding.briefVersion,understandingRef,phase:'preparing_preview' as const,activeProduction:operationId}));
  evidence.stages.project={projectId,revisionId,operationId,understandingSha256:understandingRef.sha256};await record();
  const treatmentRef=await prepareTreatmentStage(projects,projectId,revisionId,operationId,0,{env});
  const treatment=(await projects.store.readFresh<TreatmentPlan>(treatmentRef.key)).value;
  evidence.stages.treatment={treatmentRef,plan:treatment};await record();console.log(JSON.stringify({stage:'treatment',status:'pass',shots:treatment.shots.length,requests:requests.length}));
  const voice=await prepareVoiceStage(projects,projectId,revisionId,operationId,0,treatmentRef,{root,env});evidence.stages.voice=voice;await record();console.log(JSON.stringify({stage:'voice',status:'pass'}));
  const timing=await prepareTimingStage(projects,projectId,revisionId,operationId,0,treatmentRef,{root,env});evidence.stages.timing=timing;await record();
  const audio=await prepareAudioPlanStage(projects,projectId,revisionId,operationId,0,treatmentRef,{root,env});evidence.stages.audio=audio;await record();
  if(treatment.shots.length>4)throw Error('MODEL_PROBE_VISUAL_CALL_LIMIT');
  for(const shot of treatment.shots){const visual=await prepareVisualShotStage(projects,projectId,revisionId,operationId,0,treatmentRef,shot.id,{root,env});evidence.stages['visual-'+shot.id]=visual;await record();console.log(JSON.stringify({stage:'visual',shotId:shot.id,status:'pass',requests:requests.length}))}
  evidence.status='pass';
 }catch(error){
  evidence.status='blocked';evidence.errorCode=String(error instanceof Error?error.message:'REAL_CREATION_PROBE_FAILED').replaceAll(env.MODEL_API_KEY||'missing-key','[redacted]').slice(0,300);process.exitCode=1;
 }finally{recorder.restore();await record();console.log(JSON.stringify({status:evidence.status,requests,stages:Object.keys(evidence.stages),errorCode:evidence.errorCode}))}
}
main().catch(error=>{console.error(JSON.stringify({status:'fail',errorName:error?.name||'Error',errorCode:String(error?.message||'MODEL_PROBE_FAILED').replaceAll(process.env.MODEL_API_KEY||'missing-key','[redacted]').slice(0,300)}));process.exitCode=1});
