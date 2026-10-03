import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile,writeFile} from 'node:fs/promises';
import {assemblePictureSequence} from '../../src/services/video/media/picture-sequence';
const exec=promisify(execFile);
async function main(){
 if(!process.argv.includes('--cancel'))throw Error('PICTURE_CANCEL_OPT_IN_REQUIRED');
 const proof=JSON.parse(await readFile('docs/engineering/evidence/approved-pictures-probe.json','utf8'));
 const runtime=proof.record.shots[0].technicalQa,width=runtime.width,height=runtime.height,root=proof.root;
 const mediaDigest='75ffd41e03d738cee7e10914aeaeb2605b9daf213409afec295ccb97bb06c919';
 const env={VIDEO_MEDIA_IMAGE_REF:'sha256:'+mediaDigest,VIDEO_MEDIA_RUNTIME_DIGEST:mediaDigest,VIDEO_MEDIA_TIMEOUT_SECONDS:'600'};
 let checks=0,containerId='';const started=Date.now();let errorCode='';
 try{await assemblePictureSequence(root,{projectId:proof.projectId,revisionId:'cancellation-'+proof.approvalId,shots:proof.record.shots.map(({technicalQa,...shot}:{technicalQa:unknown;shotId:string;startFrame:number;endFrame:number;stageKey:string;sha256:string})=>{void technicalQa;return shot}),width,height,fps:24,runtimeDigest:mediaDigest,fence:1},env,{assertActive:async()=>{
  checks++;if(checks===2){const output=(await exec('docker',['ps','--filter','label=videobuddy.invocation','--format','{{.ID}}'])).stdout.trim();if(!output||output.includes('\n'))throw Error('CANCEL_PROBE_CONTAINER_AMBIGUOUS');containerId=output}
  if(checks>=3)throw Error('RENDER_FENCED');
 }})}catch(error){errorCode=error instanceof Error?error.message:'UNKNOWN'}
 if(errorCode!=='RENDER_FENCED'||!containerId)throw Error('CANCEL_PROBE_NOT_EXERCISED');
 const state=await exec('docker',['inspect','--format','{{.State.Running}}',containerId]).then(result=>result.stdout.trim()).catch(()=> 'removed');
 if(state==='true')throw Error('CANCEL_PROBE_CONTAINER_STILL_RUNNING');
 const result={executedAt:new Date().toISOString(),status:'pass',root,containerId,checks,errorCode,containerState:state,elapsedMs:Date.now()-started,additionalModelCalls:0,resultPublished:false,limits:'Actual isolated 1080p picture concatenation interrupted via an injected approval-fence failure during Docker execution. Matching owned container identity verified before stop; inspect afterwards confirms stopped/removed. Not full composition, provider creation or final quality acceptance.'};
 await writeFile('docs/engineering/evidence/approved-picture-cancel-probe.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
}
main().catch(error=>{console.error(JSON.stringify({status:'fail',errorCode:error.message}));process.exitCode=1});
