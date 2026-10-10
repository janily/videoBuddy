/** Native, deterministic smoke probe; no model calls. Outputs remain in its temporary directory for inspection. */
import {randomUUID} from 'node:crypto';
import {mkdtemp,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createLocalRuntime} from '../../src/services/video/media/local';
import {computeStageKey,type MediaJob} from '../../src/services/video/media/runtime';

const root=await mkdtemp(join(tmpdir(),'vb-media-probe-')),runtime=await createLocalRuntime({root,env:process.env,frameTimeoutMs:3000,timeoutMs:120000});
const sourceHtml='<!doctype html><meta charset="utf-8"><canvas id="c" width="320" height="180"></canvas><script>const x=document.getElementById("c").getContext("2d");window.render=t=>{x.fillStyle="#132b45";x.fillRect(0,0,320,180);x.fillStyle="#fff";x.font="bold 30px sans-serif";x.fillText("视频探针",20,85);x.fillText(String(t.toFixed(2)),20,140)};window.READY=true;</script>';
const base={projectId:randomUUID(),operationId:randomUUID(),attemptId:randomUUID(),bundleHash:'a'.repeat(64),runtimeDigest:runtime.runtimeDigest,sourceHtml,logicalWidth:320,logicalHeight:180,outputWidth:320,outputHeight:180,fps:24 as const,startFrame:0,endFrame:24,seed:1,fence:1};
const job=(source=sourceHtml):MediaJob=>{const input={...base,sourceHtml:source};return{...input,stageKey:computeStageKey(input)}};
try{
 const input=job(),clip=await runtime.renderShot(input),cached=await runtime.renderShot(input);
 if(clip.sha256!==cached.sha256||clip.outputPath!==cached.outputPath)throw Error('MEDIA_PROBE_CACHE_MISMATCH');
 const qa=await runtime.probe(clip.outputPath,{fullDecode:true,expected:{width:320,height:180,durationSec:1,fps:24,audio:false}});
 const final=await runtime.assemble({projectId:base.projectId,clips:[clip,clip],music:null,title:'Native media probe'});
 if(final.frameCount!==48||!final.audio||final.audioChannels!==2)throw Error('MEDIA_PROBE_ASSEMBLY_INVALID');
 const stopped=job(sourceHtml.replace('#132b45','#153449')),abort=new AbortController();let cancelled=false;
 try{await runtime.renderShot(stopped,{signal:abort.signal,onPoster:()=>abort.abort()})}catch(error){if((error as Error).message!=='MEDIA_ABORTED')throw error;cancelled=true}
 if(!cancelled||(await readdir(join(root,'media'))).includes(stopped.stageKey))throw Error('MEDIA_PROBE_CANCEL_FAILED');
 const randomScene='<!doctype html><canvas id="c" width="320" height="180"></canvas><script>const x=document.getElementById("c").getContext("2d");window.render=()=>{x.fillStyle="#"+Math.floor(Math.random()*16777215).toString(16).padStart(6,"0");x.fillRect(0,0,320,180)};window.READY=true;</script>';
 let rejected=false;try{await runtime.renderShot(job(randomScene))}catch(error){if((error as Error).message!=='NONDETERMINISTIC_SCENE')throw error;rejected=true}
 if(!rejected)throw Error('MEDIA_PROBE_DETERMINISM_FAILED');
 console.log(JSON.stringify({status:'succeeded',runtimeDigest:runtime.runtimeDigest,sandbox:runtime.version.sandbox,clip,technicalQa:qa,final,cacheVerified:true,cancellation:'confirmed',nondeterminism:'rejected',temporaryDirectory:root},null,2));
}finally{await runtime.close()}
