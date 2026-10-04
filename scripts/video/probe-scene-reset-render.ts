import {claimProbeReport,persistProbeReport} from './helpers/probe-report';
import {randomUUID,createHash} from 'node:crypto';
import {access,mkdir,mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {FileStore} from '../../src/services/video/storage/file-store';
import {canonicalHash} from '../../src/services/video/domain/hash';
import {computeStageKey} from '../../src/services/video/media/docker-executor';
import {runOwnedDocker} from '../../src/services/video/media/owned-docker';
import {technicalVideoQa} from '../../src/services/video/media/technical-qa';

async function main(){
 if(!process.argv.includes('--scene-reset-render'))throw Error('EXPLICIT_DIAGNOSTIC_REQUIRED');
 const reportPath='docs/engineering/evidence/scene-reset-render-probe.json';
 await access(reportPath).then(()=>{throw Error('PROBE_ALREADY_RECORDED_NO_AUTOMATIC_RETRY')},error=>{if(error.code!=='ENOENT')throw error});
 const previous=JSON.parse(await readFile('docs/engineering/evidence/new-theme-reviewed-preview-probe.json','utf8'));
 const diagnosis=JSON.parse(await readFile('docs/engineering/evidence/canvas-state-determinism-probe.json','utf8'));
 if(previous.status!=='blocked'||previous.stages.operation.status!=='failed'||!diagnosis.scenarios.some((s:{mode:string;status:string})=>s.mode==='reset'&&s.status==='deterministic'))throw Error('KNOWN_DIAGNOSIS_REQUIRED');
 const store=new FileStore(previous.root),prefix=`projects/${previous.projectId}`,keys=[prefix+'/control',prefix+'/budget',prefix+'/operations/'+previous.stages.operation.id];
 const before=await Promise.all(keys.map(async key=>canonicalHash((await store.readFresh(key)).value)));
 const oldRoot=join(previous.root,'media','883b9d17d355999de60a3983ebbabfe203751452b16b242eecfc4df14cdb523d');
 const oldJob=JSON.parse(await readFile(join(oldRoot,'job.json'),'utf8')),oldSource=await readFile(join(oldRoot,'scene.html'),'utf8'),marker='ctx.clearRect(0, 0, 1920, 1080);';
 if(oldSource.split(marker).length!==2||oldJob.sourceHtml!==oldSource)throw Error('DIAGNOSTIC_SOURCE_CHANGED');
 const sourceHtml=oldSource.replace(marker,'ctx.reset(); // Technical repair: reset full per-frame Canvas state.');
 const sha=(s:string)=>createHash('sha256').update(s).digest('hex'),sourceSha256=sha(oldSource),repairedSourceSha256=sha(sourceHtml);
 const parent=resolve('.video-local/scene-reset-render');await mkdir(parent,{recursive:true});const root=await mkdtemp(join(parent,'probe-')),operationId=randomUUID(),journal={store,prefix:prefix+'/operations/'+operationId+'/media-effects'};
 const parameters={projectId:oldJob.projectId,bundleHash:canonicalHash({sourceSha256,repairedSourceSha256,repair:'canvas-full-state-reset'}),runtimeDigest:oldJob.runtimeDigest,sourceHtml,logicalWidth:oldJob.logicalWidth,logicalHeight:oldJob.logicalHeight,outputWidth:oldJob.outputWidth,outputHeight:oldJob.outputHeight,fps:24 as const,startFrame:oldJob.startFrame,endFrame:oldJob.endFrame,seed:oldJob.seed,fence:oldJob.fence};
 const stageKey=computeStageKey(parameters),stageRoot=join(root,'media',stageKey);await mkdir(stageRoot,{recursive:true});
 await writeFile(join(stageRoot,'job.json'),JSON.stringify({...parameters,stageKey,operationId,attemptId:'diagnostic-source-reset'}));await writeFile(join(stageRoot,'scene.html'),sourceHtml);
 const image='sha256:'+oldJob.runtimeDigest,report:{[key:string]:unknown}={executedAt:new Date().toISOString(),root,sourceOperationId:previous.stages.operation.id,diagnosticOperationId:operationId,sourceSha256,repairedSourceSha256,stageKey,repairDiff:{before:marker,after:'ctx.reset(); // Technical repair: reset full per-frame Canvas state.'},runtimeDigest:oldJob.runtimeDigest,status:'started',technicalProbeOnly:true,deliveryEligible:false};
 await claimProbeReport(reportPath,report);
 try{
 await runOwnedDocker(['run','--rm','--network','none','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges','--pids-limit','128','--cpus','4','--memory','8g','--memory-swap','8g','--user',`${process.getuid?.()??10001}:${process.getgid?.()??10001}`,'--tmpfs','/tmp:rw,nosuid,size=256m','--mount',`type=bind,src=${stageRoot},dst=/work/${stageKey}`,'--mount',`type=bind,src=${join(stageRoot,'job.json')},dst=/work/${stageKey}/job.json,readonly`,'--mount',`type=bind,src=${join(stageRoot,'scene.html')},dst=/work/${stageKey}/scene.html,readonly`,image,'node','/opt/videobuddy/render.mjs',`/work/${stageKey}/job.json`],180000,image,undefined,journal);
 report.technicalQa=await technicalVideoQa(stageRoot,image,'output/picture.mp4',{width:parameters.outputWidth,height:parameters.outputHeight,durationSec:(parameters.endFrame-parameters.startFrame)/24,fps:24,audio:false});
 report.status='passed';
 }catch(error){report.status='failed';report.errorCode=(error as Error).message;process.exitCode=1}
 const after=await Promise.all(keys.map(async key=>canonicalHash((await store.readFresh(key)).value)));report.sourceStateUnchanged=canonicalHash(before)===canonicalHash(after);
 await persistProbeReport(reportPath,report);console.log(JSON.stringify(report));
}
main().catch(error=>{console.error(JSON.stringify({status:'failed',errorCode:error.message}));process.exitCode=1});
