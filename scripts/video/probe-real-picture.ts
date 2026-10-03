import {spawn} from 'node:child_process';
import {readFile,writeFile,realpath} from 'node:fs/promises';
import {resolve,relative,isAbsolute} from 'node:path';
import type {ObjectRef} from '../../src/contracts/video/domain';
import {FileStore} from '../../src/services/video/storage/file-store';
import {ProjectStore} from '../../src/services/video/storage/project-store';
import {canonicalHash} from '../../src/services/video/domain/hash';
import {preparePictureShotStage} from '../../src/services/video/preview/picture-stage';
import {preparePictureSequenceStage} from '../../src/services/video/preview/picture-sequence-stage';
import {probeEnvironment} from './helpers/real-probe';
async function remove(name:string){
 const child=spawn('docker',['rm','--force',name],{stdio:'ignore'});
 await new Promise<void>((resolve,reject)=>{child.once('error',reject);child.once('close',()=>resolve())});
}
async function main(){
 if(!process.argv.includes('--render'))throw Error('REAL_PICTURE_PROBE_OPT_IN_REQUIRED');
 const source=JSON.parse(await readFile('docs/engineering/evidence/real-creation-no-voice-probe.json','utf8')),visual=JSON.parse(await readFile('docs/engineering/evidence/real-visual-revalidation.json','utf8'));
 const root=await realpath(source.root),rel=relative(await realpath(resolve('.video-local/real-creation')),root);
 if(!rel||rel.startsWith('..')||isAbsolute(rel)||root!==visual.root||visual.additionalModelCalls!==0)throw Error('REAL_PICTURE_BASELINE_REQUIRED');
 const {projectId,revisionId,operationId}=source.stages.project,projects=new ProjectStore(new FileStore(root)),env=probeEnvironment(root),treatmentRef=source.stages.treatment.treatmentRef as ObjectRef;
 const savedFetch=globalThis.fetch;globalThis.fetch=async()=>{throw Error('REAL_PICTURE_NETWORK_FORBIDDEN')};
 const evidence:{executedAt:string;root:string;projectId:string;revisionId:string;actualModelSource:boolean;additionalModelCalls:number;profile:string;shots:Record<string,unknown>;status:string;sequence?:unknown;limits:string}={executedAt:new Date().toISOString(),root,projectId,revisionId,actualModelSource:true,additionalModelCalls:0,profile:'preview',shots:{},status:'running',limits:'Actual cached gemini-3.8-flash Visual HTML, frozen real Treatment/Timing, pinned offline Chromium/Docker full-frame renders at 720p. No model retries, audio mix, semantic/style QA, approved full-resolution render or user preview.'};
 try{
  let blocked=false;
  for(const shot of visual.repaired){
   const name='vb-'+operationId+'-picture-preview-'+canonicalHash({shotId:shot.shotId}).slice(0,12);
   try{
    const result=await preparePictureShotStage(projects,projectId,revisionId,operationId,0,treatmentRef,shot.shotId,{root,env,profile:'preview'});
    const replay=await preparePictureShotStage(projects,projectId,revisionId,operationId,0,treatmentRef,shot.shotId,{root,env,profile:'preview',mustExist:true});
    if(canonicalHash(result)!==canonicalHash(replay))throw Error('REAL_PICTURE_REPLAY_CHANGED');
    evidence.shots[shot.shotId]={status:'pass',result,replayIdentical:true};console.log(JSON.stringify({shotId:shot.shotId,status:'render_pass',bytes:result.technicalQa.bytes}));
   }catch(error){blocked=true;evidence.shots[shot.shotId]={status:'blocked',errorCode:String(error instanceof Error?error.message:'REAL_PICTURE_FAILED').slice(0,300)}}
   finally{await remove(name)}
   await writeFile('docs/engineering/evidence/real-picture-probe.json',JSON.stringify(evidence,null,2)+'\n');
  }
  if(!blocked)evidence.sequence=await preparePictureSequenceStage(projects,projectId,revisionId,operationId,0,treatmentRef,{root,env,profile:'preview'});
  evidence.status=blocked?'blocked':'pass';if(blocked)process.exitCode=1;
 }finally{globalThis.fetch=savedFetch;await writeFile('docs/engineering/evidence/real-picture-probe.json',JSON.stringify(evidence,null,2)+'\n');console.log(JSON.stringify({status:evidence.status,shots:Object.keys(evidence.shots),additionalModelCalls:0}))}
}
main().catch(error=>{console.error(JSON.stringify({status:'fail',errorName:error?.name||'Error',errorCode:String(error?.message||'REAL_PICTURE_FAILED').replaceAll(process.env.MODEL_API_KEY||'missing-key','[redacted]').slice(0,300)}));process.exitCode=1});
