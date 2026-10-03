import {createHash,randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {mkdtemp,readFile,stat,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {FileStore} from '../../src/services/video/storage/file-store';
import {ProjectStore} from '../../src/services/video/storage/project-store';
import type {ProjectControl} from '../../src/contracts/video/project';
import {LocalOperationQueue} from '../../src/services/video/commands/local-queue';
import {requestExport} from '../../src/services/video/exports/request';
import {persistArchiveObject} from '../../src/services/video/exports/archive-object';
import {canonicalHash} from '../../src/services/video/domain/hash';
async function main(){
 if(!process.argv.includes('--exports'))throw Error('EXPORT_OBJECT_OPT_IN_REQUIRED');
 const source=JSON.parse(await readFile('docs/engineering/evidence/source-archive-probe.json','utf8')),media=JSON.parse(await readFile('docs/engineering/evidence/approved-composition-probe.json','utf8')),original=new FileStore(media.root),controlKey=`projects/${media.projectId}/control`,before=(await original.readFresh<ProjectControl>(controlKey)).value;
 let modelCalls=0;globalThis.fetch=async()=>{modelCalls++;throw Error('EXPORT_PROBE_NETWORK_FORBIDDEN')};
 const root=await mkdtemp(join(process.cwd(),'.video-local/export-object-')),bytes=await readFile(source.path),sha=(body:Buffer)=>createHash('sha256').update(body).digest('hex');if(sha(bytes)!==source.sha256)throw Error('EXPORT_SOURCE_CHANGED');
 const artifactId=randomUUID(),key=`projects/${media.projectId}/artifacts/${artifactId}/files/source.zip`;
 await persistArchiveObject(root,key,source.sha256,bytes);await persistArchiveObject(root,key,source.sha256,bytes);
 let replacementBlocked=false;const other=Buffer.from('Different bytes must never overwrite the actual archive');
 try{await persistArchiveObject(root,key,sha(other),other)}catch(error){if(!(error instanceof Error)||error.message!=='ARTIFACT_INVALID')throw error;replacementBlocked=true}
 const actual=await readFile(join(root,'objects',key)),info=await stat(join(root,'objects',key));if(sha(actual)!==source.sha256||!replacementBlocked||info.nlink!==1||(info.mode&0o777)!==0o600)throw Error('EXPORT_OBJECT_CHANGED');
 const checked=spawnSync('python3',['-c',"import sys,zipfile; z=zipfile.ZipFile(sys.argv[1]); assert z.testzip() is None; print(len(z.namelist()))",join(root,'objects',key)],{encoding:'utf8',timeout:30000});if(checked.status!==0)throw Error('EXPORT_ZIP_INVALID');
 const store=new FileStore(root),projects=new ProjectStore(store),queue=new LocalOperationQueue(store,root);await store.create(controlKey,before);
 const preview=(await original.readFresh<{previewArtifactId:string}>(`projects/${media.projectId}/previews/${before.currentPreviewId}/manifest`)).value;
 let unqualifiedCode='';try{await requestExport(projects,queue,before.ownerKeyHash,media.projectId,{schemaVersion:5,clientCommandId:randomUUID(),artifactId:preview.previewArtifactId,format:'source_zip'},root)}catch(error){unqualifiedCode=error instanceof Error?error.message:'UNKNOWN'}
 if(unqualifiedCode!=='RESULT_STALE'||(await queue.pending()).length||modelCalls||canonicalHash(before)!==canonicalHash((await original.readFresh(controlKey)).value))throw Error('EXPORT_UNQUALIFIED_GATE_FAILED');
 const result={executedAt:new Date().toISOString(),status:'pass',root,projectId:media.projectId,objectPath:join(root,'objects',key),sha256:source.sha256,bytes:actual.length,entries:Number(checked.stdout.trim()),mode:'0600',links:info.nlink,replayIdentical:true,replacementBlocked,independentZipCrcPassed:true,realUnqualifiedExportBlocked:unqualifiedCode,queuedOperations:0,originalControlUnchanged:true,additionalModelCalls:modelCalls,finalResultPublished:false,limits:'Actual existing frozen ZIP persisted and replayed by the new no-follow immutable publisher; no fake QA created. The real preview/diagnostic film lacks a published qualified result and correctly cannot enter the public export flow. Authenticated positive HTTP/worker/SSE/download flow is covered by explicit protocol fixtures, not real final video quality evidence.'};
 await writeFile('docs/engineering/evidence/export-object-probe.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
}
main().catch(error=>{console.error(JSON.stringify({status:'fail',errorCode:error.message}));process.exitCode=1});
