import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {copyFile,mkdir,mkdtemp,readdir,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {transcribeAudio} from '../../src/services/video/audio/asr';
import {inspectVoiceWav} from '../../src/services/video/audio/wav';
const exec=promisify(execFile);
async function main(){
 if(!process.argv.includes('--cancel'))throw Error('ASR_CANCEL_OPT_IN_REQUIRED');
 const digest='67786e6dbdd6b00f6177441e64272b622f844fc6c69b39970543afa92cc4895c';
 const source=resolve('.video-local/real-creation/65ff1a5e-8d4f-4b2b-a718-be5b85ea1af8/voice/1419f592daf332740075013f58e1106d2742943d23bef760c2d8e6bf7809b541/output/narration.wav');
 const root=await mkdtemp(resolve('.video-local/asr-cancel-')),directory=join(root,'postmix');await mkdir(directory);const outputPath=join(directory,'line.wav');await copyFile(source,outputPath);
 const wav=await inspectVoiceWav(outputPath),env={VIDEO_ASR_IMAGE_REF:'sha256:'+digest,VIDEO_ASR_RUNTIME_DIGEST:digest};
 let checks=0,containerId='',errorCode='';const started=Date.now();
 try{await transcribeAudio(root,{language:'auto',outputPath,wav},'postmix',env,{assertActive:async()=>{
  checks++;if(containerId)throw Error('RENDER_FENCED');
  const ids=(await exec('docker',['ps','--filter','label=videobuddy.invocation','--filter','ancestor=sha256:'+digest,'--format','{{.ID}}'])).stdout.trim();
  if(ids.includes('\n'))throw Error('ASR_CANCEL_AMBIGUOUS');if(ids)containerId=ids;
 }})}catch(error){errorCode=error instanceof Error?error.message:'UNKNOWN'}
 if(errorCode!=='RENDER_FENCED'||!containerId)throw Error('ASR_CANCEL_NOT_EXERCISED');
 const state=await exec('docker',['inspect','--format','{{.State.Running}}',containerId]).then(result=>result.stdout.trim()).catch(()=> 'removed');
 const stages=await readdir(join(root,'asr'));for(const stage of stages)if((await readdir(join(root,'asr',stage))).includes('transcript.json'))throw Error('ASR_CANCEL_TRANSCRIPT_ARCHIVED');
 if(state==='true')throw Error('ASR_CANCEL_CONTAINER_RUNNING');
 const result={executedAt:new Date().toISOString(),status:'pass',root,sourceSha256:wav.sha256,containerId,containerState:state,checks,errorCode,elapsedMs:Date.now()-started,transcriptArchived:false,additionalModelCalls:0,limits:'Actual offline ASR of a copied archived WAV interrupted through an injected live fence. Matching owned container stopped/removed; no transcript persisted. Not a semantic/listening or full narrated approved-film pass.'};
 await writeFile('docs/engineering/evidence/asr-cancel-probe.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
}
main().catch(error=>{console.error(JSON.stringify({status:'fail',errorCode:error.message}));process.exitCode=1});
