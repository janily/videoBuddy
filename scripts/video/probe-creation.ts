import {randomUUID,randomBytes} from 'node:crypto';
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
import type {Environment} from '../../src/services/video/config/environment';

// One bounded real creative pipeline. Failure retains its isolated work directory and paid effect records.
async function main(){
 if(!process.argv.includes('--real'))throw Error('REAL_MODEL_PROBE_OPT_IN_REQUIRED');
 const source=JSON.parse(await readFile('docs/engineering/evidence/real-director-probe.json','utf8')),understanding=UnderstandingSchema.parse(source.understanding);
 const root=resolve('.video-local','real-creation',randomUUID());await mkdir(root,{recursive:true,mode:0o700});
 const env:Environment={...process.env,VIDEO_ENVIRONMENT:'local-probe',VIDEO_APP_ORIGIN:'http://localhost:3000',VIDEO_SESSION_SIGNING_KEY:randomBytes(32).toString('hex'),VIDEO_DATA_DIR:root,VIDEO_GENERATION_ENABLED:'true',VIDEO_PROJECT_MAX_MODEL_CALLS:'6',VIDEO_PROJECT_MAX_INPUT_TOKENS:'600000',VIDEO_PROJECT_MAX_OUTPUT_TOKENS:'80000',VIDEO_PROJECT_MAX_TTS_CHARACTERS:'1000',VIDEO_PROJECT_MAX_MEDIA_SECONDS:'120',VIDEO_DAILY_MAX_MODEL_CALLS:'6',VIDEO_DAILY_MAX_MEDIA_SECONDS:'120',
 VIDEO_VOICE_IMAGE_REF:'sha256:831c0ff8261e75468b3a6868ca29f5b3fd1eee6b222031912eff4e13071e6e64',VIDEO_VOICE_RUNTIME_DIGEST:'831c0ff8261e75468b3a6868ca29f5b3fd1eee6b222031912eff4e13071e6e64',
 VIDEO_ASR_IMAGE_REF:'sha256:67786e6dbdd6b00f6177441e64272b622f844fc6c69b39970543afa92cc4895c',VIDEO_ASR_RUNTIME_DIGEST:'67786e6dbdd6b00f6177441e64272b622f844fc6c69b39970543afa92cc4895c',
 VIDEO_MEDIA_IMAGE_REF:'sha256:75ffd41e03d738cee7e10914aeaeb2605b9daf213409afec295ccb97bb06c919',VIDEO_MEDIA_RUNTIME_DIGEST:'75ffd41e03d738cee7e10914aeaeb2605b9daf213409afec295ccb97bb06c919',VIDEO_MEDIA_TIMEOUT_SECONDS:'300'};
 const original=globalThis.fetch,provider=new URL(env.MODEL_BASE_URL!),requests:Array<{status?:number;model:string;maxTokens?:number;usage?:unknown}>=[],reads:Promise<void>[]=[];
 globalThis.fetch=async(input,init)=>{
  const url=new URL(input instanceof Request?input.url:String(input));
  if(url.origin!==provider.origin||url.pathname!==provider.pathname.replace(/\/$/,'')+'/chat/completions')throw Error('MODEL_PROBE_UNEXPECTED_DESTINATION');
  if(requests.length>=6)throw Error('MODEL_PROBE_CALL_LIMIT');
  const body=JSON.parse(String(init?.body||'{}')),entry={model:String(body.model),maxTokens:body.max_tokens??body.max_completion_tokens} as typeof requests[number];requests.push(entry);
  const response=await original(input,{...init,signal:AbortSignal.any([AbortSignal.timeout(120000),...(init?.signal?[init.signal]:[])])});entry.status=response.status;
  reads.push(response.clone().text().then(text=>{try{entry.usage=JSON.parse(text).usage}catch{}}));return response;
 };
 const evidence:{executedAt:string;model:string|undefined;root:string;stages:Record<string,unknown>;requests:typeof requests;status:string;errorCode?:string;limits:string}={executedAt:new Date().toISOString(),model:env.VIDEO_DIRECTOR_MODEL,root,stages:{},requests,status:'running',limits:'Opt-in isolated local real-model pipeline, maximum six HTTP calls and no automatic retries. Provider ignores output caps; requests and observed usage are recorded, no claim of hard token bounds, semantic/style/listening QA or approved final movie.'};
 async function record(){await Promise.all(reads);await writeFile('docs/engineering/evidence/real-creation-probe.json',JSON.stringify(evidence,null,2)+'\n')}
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
 }finally{globalThis.fetch=original;await record();console.log(JSON.stringify({status:evidence.status,requests,stages:Object.keys(evidence.stages),errorCode:evidence.errorCode}))}
}
main().catch(error=>{console.error(JSON.stringify({status:'fail',errorName:error?.name||'Error',errorCode:String(error?.message||'MODEL_PROBE_FAILED').replaceAll(process.env.MODEL_API_KEY||'missing-key','[redacted]').slice(0,300)}));process.exitCode=1});
