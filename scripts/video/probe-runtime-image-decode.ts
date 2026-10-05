import {createHash,randomUUID} from 'node:crypto';
import {mkdtemp,mkdir,readFile,writeFile,readdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {FileStore} from '../../src/services/video/storage/file-store';
import {LocalAssetBytes} from '../../src/services/video/assets/local-bytes';
import {runOwnedDocker} from '../../src/services/video/media/owned-docker';
import {canonicalHash} from '../../src/services/video/domain/hash';
import {claimProbeReport,persistProbeReport} from './helpers/probe-report';
async function snapshot(root:string){const out:Record<string,string>={};async function walk(dir:string){for(const e of await readdir(dir,{withFileTypes:true})){const path=join(dir,e.name);if(e.isDirectory())await walk(path);else if(e.name.endsWith('.json'))out[path]=createHash('sha256').update(await readFile(path)).digest('hex')}}await walk(root);return canonicalHash(out)}
async function main(){
 const mode=process.argv[2];if(!['--before-fix','--after-fix'].includes(mode))throw Error('EXPLICIT_DIAGNOSTIC_REQUIRED');
 const prior=JSON.parse(await readFile('docs/engineering/evidence/runtime-assets-v2-probe.json','utf8')),build=JSON.parse(await readFile('.video-local/runtime-assets-build-current.json','utf8')),image=mode==='--before-fix'?prior.image:(await readFile(join(build.root,'image-id.txt'),'utf8')).trim();
 if(!/^sha256:[a-f0-9]{64}$/.test(image))throw Error('PINNED_IMAGE_REQUIRED');
 const legacy=JSON.parse(await readFile('docs/engineering/evidence/clear-full-film-technical-probe.json','utf8')),critic=JSON.parse(await readFile('docs/engineering/evidence/clear-full-film-critic-probe.json','utf8')),originalRoots=[legacy.sourceRoot,critic.root],before=await Promise.all(originalRoots.map(snapshot));
 const root=await mkdtemp(resolve('.video-local/runtime-image-decode-')),projectId=randomUUID(),operationId=randomUUID(),journal={store:new FileStore(root),prefix:`projects/${projectId}/operations/${operationId}/media-effects`},id=randomUUID(),data=Buffer.alloc(24);Buffer.from('89504e470d0a1a0a','hex').copy(data);data.write('IHDR',12);
 const uploaded=await new LocalAssetBytes(root).put(projectId,id,new Request('http://fixture/upload',{method:'PUT',body:data}),{declaredMime:'image/png',declaredBytes:24}),asset={id,mime:'image/png',bytes:24,sha256:uploaded.sha256},sourceHtml="<!doctype html><script>window.Image=class{decode(){return Promise.resolve()}};HTMLImageElement.prototype.decode=()=>Promise.resolve();window.READY=true;window.render=t=>{};</script>";
 const path=`docs/engineering/evidence/runtime-image-decode-${mode.slice(2)}.json`,report:Record<string,unknown>={executedAt:new Date().toISOString(),status:'running',mode,root,image,projectId,operationId,asset,modelCalls:0,formalProductionApproval:false,deliveryEligible:false,fixture:'Truncated signature-valid PNG and generated scene overriding Image and native decode; no semantic/style QA.'};await claimProbeReport(path,report);
 const assertActive=async()=>{if(canonicalHash(await Promise.all(originalRoots.map(snapshot)))!==canonicalHash(before))throw Error('ORIGINAL_STATE_CHANGED')};
 try{
  const stageKey=canonicalHash({asset,sourceHtml,image}),dir=join(root,'media',stageKey);await mkdir(join(dir,'assets'),{recursive:true});await writeFile(join(dir,'assets',id+'.bin'),data);await writeFile(join(dir,'scene.html'),sourceHtml);await writeFile(join(dir,'job.json'),JSON.stringify({assets:[asset],logicalWidth:320,logicalHeight:180,outputWidth:320,outputHeight:180,startFrame:0,endFrame:1,fps:24}));
  const args=['run','--rm','--network','none','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges','--pids-limit','128','--cpus','4','--memory','8g','--user',`${process.getuid?.()??10001}:${process.getgid?.()??10001}`,'--tmpfs','/tmp:rw,nosuid,size=256m','--mount',`type=bind,src=${dir},dst=/work/${stageKey}`,image,'node','/opt/videobuddy/render.mjs',`/work/${stageKey}/job.json`];
  let errorCode:string|undefined;try{await runOwnedDocker(args,150000,image,assertActive,journal)}catch(error){errorCode=(error as Error).message.slice(0,200)}
  let output:Buffer|undefined;try{output=await readFile(join(dir,'output','picture.mp4'))}catch{}
  report.output=output?{bytes:output.length,sha256:createHash('sha256').update(output).digest('hex')}:null;report.errorCode=errorCode;
  if(mode==='--before-fix'){if(errorCode||!output)throw Error('EXPECTED_BYPASS_NOT_REPRODUCED');report.status='actual_decode_bypass_reproduced'}else{if(errorCode==='MEDIA_STOP_UNKNOWN')throw Error('MEDIA_STOP_UNKNOWN');if(!errorCode||output)throw Error('DECODE_BYPASS_NOT_BLOCKED');report.status='actual_decode_bypass_blocked'}
 }catch(error){report.status='failed';report.errorCode=(error as Error).message.slice(0,200);process.exitCode=1}
 finally{report.originalStateNativeAndModelUnknownUnchanged=canonicalHash(await Promise.all(originalRoots.map(snapshot)))===canonicalHash(before);if(!report.originalStateNativeAndModelUnknownUnchanged){report.status='failed';process.exitCode=1}const keys=await journal.store.listKeys(journal.prefix,1);report.nativeJournal=await Promise.all(keys.map(async key=>(await journal.store.readFresh(key)).value));await persistProbeReport(path,report);console.log(JSON.stringify({status:report.status,output:report.output,errorCode:report.errorCode,originalUnchanged:report.originalStateNativeAndModelUnknownUnchanged}))}
}
main().catch(error=>{console.error(String(error.message).slice(0,200));process.exitCode=1});
