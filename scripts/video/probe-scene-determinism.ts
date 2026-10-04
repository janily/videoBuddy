import {claimProbeReport,persistProbeReport} from './helpers/probe-report';
import {randomUUID,createHash} from 'node:crypto';
import {mkdir,mkdtemp,readFile,writeFile,access,chmod} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {FileStore} from '../../src/services/video/storage/file-store';
import {canonicalHash} from '../../src/services/video/domain/hash';
import {runOwnedDocker} from '../../src/services/video/media/owned-docker';

async function main(){
 const canvasState=process.argv.includes('--canvas-state-determinism'),reportPath=canvasState?'docs/engineering/evidence/canvas-state-determinism-probe.json':'docs/engineering/evidence/scene-determinism-probe.json';
 await access(reportPath).then(()=>{throw Error('PROBE_ALREADY_RECORDED_NO_AUTOMATIC_RETRY')},error=>{if(error.code!=='ENOENT')throw error});
 if(!canvasState&&!process.argv.includes('--scene-determinism'))throw Error('EXPLICIT_DIAGNOSTIC_REQUIRED');
 const source=JSON.parse(await readFile('docs/engineering/evidence/new-theme-reviewed-preview-probe.json','utf8'));
 if(source.status!=='blocked'||source.stages.operation.status!=='failed'||source.stages.operation.stage!=='picture')throw Error('KNOWN_FAILED_SCENE_REQUIRED');
 const store=new FileStore(source.root),prefix=`projects/${source.projectId}`,control=(await store.readFresh(prefix+'/control')).value,budget=(await store.readFresh(prefix+'/budget')).value,operation=(await store.readFresh(prefix+'/operations/'+source.stages.operation.id)).value;
 const stageDir=join(source.root,'media','883b9d17d355999de60a3983ebbabfe203751452b16b242eecfc4df14cdb523d'),jobPath=join(stageDir,'job.json'),scenePath=join(stageDir,'scene.html'),state=JSON.parse(await readFile(join(stageDir,'state.json'),'utf8')),job=JSON.parse(await readFile(jobPath,'utf8'));
 if(state.status!=='failed'||state.errorCode!=='RENDER_FAILED'||job.operationId!==source.stages.operation.id)throw Error('KNOWN_FAILED_SCENE_REQUIRED');
 const parent=resolve('.video-local/scene-determinism');await mkdir(parent,{recursive:true});const root=await mkdtemp(join(parent,'probe-')),diagnosticOperationId=randomUUID(),journal={store,prefix:prefix+'/operations/'+diagnosticOperationId+'/media-effects'};
 const scriptBytes=await readFile(resolve('runtime/media/diagnostics/scene-determinism.mjs')),scriptSha256=createHash('sha256').update(scriptBytes).digest('hex'),scriptPath=join(root,'scene-determinism.mjs'),image='sha256:'+job.runtimeDigest,report:{executedAt:string;root:string;projectId:string;sourceOperationId:string;diagnosticOperationId:string;scriptSha256:string;status:string;scenarios:unknown[];sourceStateUnchanged?:boolean;errorCode?:string}={executedAt:new Date().toISOString(),root,projectId:source.projectId,sourceOperationId:source.stages.operation.id,diagnosticOperationId,scriptSha256,status:'started',scenarios:[]};
 await writeFile(scriptPath,scriptBytes,{flag:'wx',mode:0o444});await chmod(scriptPath,0o444);
 await claimProbeReport(reportPath,report);
 try{for(const mode of (canvasState?['readback','reset']:['default','software'])){
  const output=join(root,mode);await mkdir(output);
  const args=['run','--rm','--network','none','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges','--pids-limit','128','--cpus','4','--memory','6g','--memory-swap','6g','--user',`${process.getuid?.()??10001}:${process.getgid?.()??10001}`,'--tmpfs','/tmp:rw,nosuid,size=256m','--mount',`type=bind,src=${jobPath},dst=/input/job.json,readonly`,'--mount',`type=bind,src=${scenePath},dst=/input/scene.html,readonly`,'--mount',`type=bind,src=${scriptPath},dst=/opt/videobuddy/scene-determinism.mjs,readonly`,'--mount',`type=bind,src=${output},dst=/output`,image,'node','/opt/videobuddy/scene-determinism.mjs',mode];
  report.scenarios.push(JSON.parse(await runOwnedDocker(args,120000,image,undefined,journal)));
 }report.status='diagnosed'}catch(error){report.status='failed';report.errorCode=(error as Error).message;process.exitCode=1}
 report.sourceStateUnchanged=canonicalHash((await store.readFresh(prefix+'/control')).value)===canonicalHash(control)&&canonicalHash((await store.readFresh(prefix+'/budget')).value)===canonicalHash(budget)&&canonicalHash((await store.readFresh(prefix+'/operations/'+source.stages.operation.id)).value)===canonicalHash(operation);
 await persistProbeReport(reportPath,report);console.log(JSON.stringify({status:report.status,errorCode:report.errorCode,root,scenarios:report.scenarios.map(value=>{const r=value as {mode:string;status:string};return{mode:r.mode,status:r.status}})}));
}
main().catch(error=>{console.error(JSON.stringify({status:'failed',errorCode:error.message}));process.exitCode=1});
