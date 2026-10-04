import {randomUUID,createHash} from 'node:crypto';
import {mkdir,mkdtemp,readFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {FileStore} from '../../src/services/video/storage/file-store';
import {runOwnedDocker} from '../../src/services/video/media/owned-docker';
import {bookCaptionStyle} from '../../src/services/video/media/book-caption-layer';
import {composeVideo} from '../../src/services/video/media/compose';
import {inspectStereoTrackWav} from '../../src/services/video/audio/wav';
import {canonicalHash} from '../../src/services/video/domain/hash';
import {claimProbeReport,persistProbeReport} from './helpers/probe-report';
const sha=(b:Buffer)=>createHash('sha256').update(b).digest('hex');
async function main(){
 if(process.argv.slice(2).join(' ')!=='--verify-real-book-composition')throw Error('BOOK_COMPOSITION_FLAG_REQUIRED');
 const path='docs/engineering/evidence/book-composition-probe.json',sourceRoot=resolve('.video-local/new-theme/seed-oD7Sxk'),project='4a5c6131-3842-440c-a551-7d8fcf6e7c95',revision='35f71e39-809d-479d-b23e-3aca60ab6e41',revisionDir=join(sourceRoot,'projects',project,'revisions',revision);
 const timingPath=join(revisionDir,'timing-draft','1b050bc21f181cbccb29a35643ce7fe415c32fe63b89bba35b388f1945a948a8.json'),executionPath=join(revisionDir,'audio-execution','22453e034205fa17cf36138e65f03555aa9d0c7816b5fe7a37de5ef172aa9530.json'),controlPath=join(sourceRoot,'projects',project,'control.json');
 const [timingBytes,executionBytes,controlBytes]=await Promise.all([readFile(timingPath),readFile(executionPath),readFile(controlPath)]),timing=JSON.parse(timingBytes.toString()),execution=JSON.parse(executionBytes.toString()),masterPath=join(sourceRoot,'audio-master',execution.master.stageKey,'output','master.wav'),sourceMaster=await inspectStereoTrackWav(masterPath,960000,false);
 if(sourceMaster.sha256!==execution.tracks.mix.wav.sha256)throw Error('BOOK_COMPOSITION_SOURCE_CHANGED');
 const pictureStage=join(sourceRoot,'picture-sequence','268b71b616d4685fc88b3b440b9ad6c0fb1a4737123ef3c613dcb9858b0eba9e'),pictureSha=sha(await readFile(join(pictureStage,'output','picture.mp4'))),image='sha256:46a3a937735e1f0472fecc8e32b78da99c7da187aa1faac7017c523b92911dfb';
 const report:Record<string,unknown>={executedAt:new Date().toISOString(),status:'started',image,sourceProject:project,sourceRevision:revision,sourceMasterSha256:sourceMaster.sha256,sourcePictureSha256:pictureSha,sourceTimingSha256:sha(timingBytes),sourceControlSha256:sha(controlBytes),sourceExecutionSha256:sha(executionBytes),newModelCalls:0,formalProductionApproval:false,deliveryEligible:false};
 await claimProbeReport(path,report);const parent=resolve('.video-local/book-composition');await mkdir(parent,{recursive:true});const root=await mkdtemp(join(parent,'probe-')),output=join(root,'track');await mkdir(output);
 const store=new FileStore(root),journal={store,prefix:`projects/${randomUUID()}/operations/${randomUUID()}/media-effects`};report.root=root;report.journalPrefix=journal.prefix;await persistProbeReport(path,report);
 try{
  const importer=String.raw`import hashlib,json,subprocess,sys
p='/input/master.wav'
assert hashlib.sha256(open(p,'rb').read()).hexdigest()==sys.argv[1]
subprocess.run(['ffmpeg','-v','error','-xerror','-nostdin','-i',p,'-c:a','pcm_f32le','-ar','48000','-ac','2','-y','/output/master.wav'],check=True)
print(json.dumps({'sourceSha256':sys.argv[1],'outputSha256':hashlib.sha256(open('/output/master.wav','rb').read()).hexdigest()}))`;
  const raw=await runOwnedDocker(['run','--rm','--network','none','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges','--pids-limit','64','--cpus','1','--memory','256m','--memory-swap','256m','--user',`${process.getuid?.()??10001}:${process.getgid?.()??10001}`,'--mount',`type=bind,src=${masterPath},dst=/input/master.wav,readonly`,'--mount',`type=bind,src=${output},dst=/output`,image,'python3','-c',importer,sourceMaster.sha256],30000,image,undefined,journal);
  const imported=JSON.parse(raw),trackPath=join(output,'master.wav'),wav=await inspectStereoTrackWav(trackPath,960000,false);if(imported.sourceSha256!==sourceMaster.sha256||imported.outputSha256!==wav.sha256)throw Error('BOOK_COMPOSITION_IMPORT_CHANGED');report.importedMaster={...imported,wav};await persistProbeReport(path,report);
  const cues=timing.captions.map((cue:{lineId:string;text:string;startFrame:number;endFrame:number;voiceSha256:string})=>({...cue,endFrame:cue.endFrame+Math.ceil(350*timing.fps/1000),startMs:Math.round(cue.startFrame*1000/timing.fps),endMs:Math.round((cue.endFrame+Math.ceil(350*timing.fps/1000))*1000/timing.fps)}));
  report.derivedCues=cues;report.captionHoldExtensionFrames=Math.ceil(350*timing.fps/1000);await persistProbeReport(path,report);
  const style=bookCaptionStyle({width:1920,height:1080},{x:100,y:800,width:1720,height:200}),spec={width:1280,height:720,durationSec:20,fps:24 as const,bundleHash:canonicalHash({sourceTiming:sha(timingBytes),pictureSha,imported,cues,style}),fence:0},env={VIDEO_MEDIA_IMAGE_REF:image,VIDEO_MEDIA_RUNTIME_DIGEST:image.slice(7),VIDEO_MEDIA_TIMEOUT_SECONDS:'900'};
  const composed=await composeVideo(root,pictureStage,{outputPath:trackPath,runtimeDigest:image.slice(7),wav,kind:'film_mix',qaStatus:'not_checked'},cues,style,spec,env,{journal});report.composed=composed;await persistProbeReport(path,report);
  const cold=await composeVideo(root,pictureStage,{outputPath:trackPath,runtimeDigest:image.slice(7),wav,kind:'film_mix',qaStatus:'not_checked'},cues,style,spec,env,{journal,mustExist:true});if(canonicalHash(cold)!==canonicalHash(composed))throw Error('BOOK_COMPOSITION_COLD_CHANGED');report.coldReadMatches=true;
  if(sha(await readFile(controlPath))!==sha(controlBytes)||sha(await readFile(timingPath))!==sha(timingBytes)||sha(await readFile(executionPath))!==sha(executionBytes)||sha(await readFile(masterPath))!==sourceMaster.sha256||sha(await readFile(join(pictureStage,'output','picture.mp4')))!==pictureSha)throw Error('BOOK_COMPOSITION_SOURCE_CHANGED');
  report.sourceStateUnchanged=true;report.status='real_book_composition_and_cold_receipts_verified';
 }catch(error){report.status='failed';report.errorCode=String((error as Error).message).split('\n')[0].slice(0,300);process.exitCode=1}
 finally{report.invocations=await Promise.all((await store.listKeys(journal.prefix,1)).map(async key=>(await store.readFresh(key)).value));await persistProbeReport(path,report);console.log(JSON.stringify({status:report.status,errorCode:report.errorCode,root,newModelCalls:0}))}
}
main().catch(error=>{console.error(String(error.message));process.exitCode=1});
