import {readFile,writeFile,realpath} from 'node:fs/promises';
import {resolve,relative,isAbsolute} from 'node:path';
import type {ObjectRef,Understanding} from '../../src/contracts/video/domain';
import type {ProjectControl} from '../../src/contracts/video/project';
import type {TreatmentPlan} from '../../src/contracts/video/treatment';
import {FileStore} from '../../src/services/video/storage/file-store';
import {ProjectStore} from '../../src/services/video/storage/project-store';
import {prepareVisualShotStage} from '../../src/services/video/preview/visual-stage';
import {probeEnvironment,recordModelRequests} from './helpers/real-probe';
async function main(){
 if(!process.argv.includes('--real'))throw Error('REAL_MODEL_PROBE_OPT_IN_REQUIRED');
 const source=JSON.parse(await readFile('docs/engineering/evidence/real-creation-no-voice-probe.json','utf8'));
 const root=await realpath(source.root),rel=relative(await realpath(resolve('.video-local/real-creation')),root);
 if(!rel||rel.startsWith('..')||isAbsolute(rel)||!source.stages.timing||!source.stages.voice)throw Error('VISUAL_PROBE_BASELINE_REQUIRED');
 const {projectId,revisionId,operationId}=source.stages.project,treatmentRef=source.stages.treatment.treatmentRef as ObjectRef,projects=new ProjectStore(new FileStore(root)),env=probeEnvironment(root);
 const treatment=(await projects.store.readFresh<TreatmentPlan>(treatmentRef.key)).value,control=(await projects.store.readFresh<ProjectControl>('projects/'+projectId+'/control')).value;
 const understanding=(await projects.store.readFresh<Understanding>(control.understandingRef.key)).value;
 if(understanding.preferences.voiceMode!=='none'||source.requests.length!==2||treatment.shots.length>4)throw Error('VISUAL_PROBE_BASELINE_REQUIRED');
 const recorder=recordModelRequests(env,root,4),evidence:{executedAt:string;root:string;projectId:string;revisionId:string;requests:typeof recorder.requests;shots:Record<string,unknown>;status:string;limits:string}={executedAt:new Date().toISOString(),root,projectId,revisionId,requests:recorder.requests,shots:{},status:'running',limits:'Read-only reuse of real Treatment/Timing from an explicit no-voice case. Audio model previously failed its event guard and is not retried. At most four additional HTTP calls; project aggregate budget six. Visual success is source validation only, no rendered movie or style QA.'};
 try{
  let blocked=false;
  for(const shot of treatment.shots){
   try{const result=await prepareVisualShotStage(projects,projectId,revisionId,operationId,0,treatmentRef,shot.id,{root,env});evidence.shots[shot.id]={status:'pass',result};console.log(JSON.stringify({shotId:shot.id,status:'source_pass'}))}
   catch(error){blocked=true;evidence.shots[shot.id]={status:'blocked',errorCode:String(error instanceof Error?error.message:'VISUAL_PROBE_FAILED').replaceAll(env.MODEL_API_KEY||'missing-key','[redacted]').slice(0,300)}}
   await recorder.flush();await writeFile('docs/engineering/evidence/real-visual-probe.json',JSON.stringify(evidence,null,2)+'\n');
  }
  evidence.status=blocked?'blocked':'pass';if(blocked)process.exitCode=1;
 }finally{recorder.restore();await recorder.flush();await writeFile('docs/engineering/evidence/real-visual-probe.json',JSON.stringify(evidence,null,2)+'\n');console.log(JSON.stringify({status:evidence.status,requests:recorder.requests,shots:Object.keys(evidence.shots)}))}
}
main().catch(error=>{console.error(JSON.stringify({status:'fail',errorName:error?.name||'Error',errorCode:String(error?.message||'VISUAL_PROBE_FAILED').replaceAll(process.env.MODEL_API_KEY||'missing-key','[redacted]').slice(0,300)}));process.exitCode=1});
