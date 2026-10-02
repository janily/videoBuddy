import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {computeStageKey,DockerExecutor} from '../../src/services/video/media/docker-executor';
import {technicalVideoQa} from '../../src/services/video/media/technical-qa';
import {assemblePictureSequence,type PictureClip} from '../../src/services/video/media/picture-sequence';

async function docker(args:string[],capture=true){
 const child=spawn('docker',args,{stdio:['ignore','pipe','pipe']}),out:Buffer[]=[],err:Buffer[]=[];
 child.stdout.on('data',(part:Buffer)=>out.push(part));child.stderr.on('data',(part:Buffer)=>err.push(part));
 const code=await new Promise<number>((resolve,reject)=>{child.once('error',reject);child.once('close',value=>resolve(value??1))});
 if(code!==0)throw Error(`DOCKER_FAILED: ${Buffer.concat(err).toString('utf8').slice(0,300)}`);
 return capture?Buffer.concat(out):Buffer.alloc(0);
}
async function pixel(image:string,path:string,second:number){
 const raw=await docker(['run','--rm','--network','none','--read-only','--mount',`type=bind,src=${path},dst=/input/picture.mp4,readonly`,image,'ffmpeg','-v','error','-ss',String(second),'-i','/input/picture.mp4','-frames:v','1','-vf','crop=2:2:160:90','-f','rawvideo','-pix_fmt','rgb24','-']);
 if(raw.length!==12)throw Error('PICTURE_PIXEL_PROBE_INVALID');return [...raw.subarray(0,3)];
}
async function main(){
 const image=process.env.VIDEO_MEDIA_IMAGE_REF;
 if(!image||!/^sha256:[a-f0-9]{64}$/.test(image))throw Error('CAPABILITY_UNAVAILABLE: VIDEO_MEDIA_IMAGE_REF');
 process.env.VIDEO_MEDIA_RUNTIME_DIGEST=image.slice(7);process.env.VIDEO_MEDIA_TIMEOUT_SECONDS='180';
 const root=await mkdtemp(join(tmpdir(),'vb-picture-sequence-')),executor=new DockerExecutor(root),projectId=randomUUID(),revisionId=randomUUID(),operationId=randomUUID(),clips:PictureClip[]=[],containers:string[]=[];
 try{
  for(const [index,color] of ['#aa4422','#2255aa'].entries()){
   const sourceHtml=`<!doctype html><html><meta charset="utf-8"><canvas id="c" width="320" height="180"></canvas><script>const c=document.getElementById("c"),x=c.getContext("2d");window.render=t=>{x.fillStyle="${color}";x.fillRect(0,0,320,180);x.fillStyle="#ffffff";x.fillRect(20+t,20,12,12)};window.READY=true;</script></html>`;
   const parameters={projectId,bundleHash:'a'.repeat(64),runtimeDigest:image.slice(7),sourceHtml,logicalWidth:320,logicalHeight:180,outputWidth:320,outputHeight:180,fps:24 as const,startFrame:index*240,endFrame:(index+1)*240,seed:7,fence:0};
   const stageKey=computeStageKey(parameters),handle=await executor.submit({...parameters,operationId,attemptId:`seq-${index}`,stageKey});containers.push(handle.containerName);
   let state=await executor.inspect(handle);const deadline=Date.now()+180000;
   while(state.status==='running'&&Date.now()<deadline){await new Promise(resolve=>setTimeout(resolve,500));state=await executor.inspect(handle)}
   if(state.status!=='succeeded')throw Error(`PICTURE_SHOT_FAILED: ${JSON.stringify(state)}`);
   const qa=await technicalVideoQa(join(root,'media',stageKey),image,'output/picture.mp4',{width:320,height:180,durationSec:10,fps:24,audio:false});
   clips.push({shotId:`shot-${index}`,startFrame:index*240,endFrame:(index+1)*240,stageKey,sha256:qa.sha256});
  }
  const result=await assemblePictureSequence(root,{projectId,revisionId,shots:clips,width:320,height:180,fps:24,runtimeDigest:image.slice(7),fence:0});
  const replay=await assemblePictureSequence(root,{projectId,revisionId,shots:clips,width:320,height:180,fps:24,runtimeDigest:image.slice(7),fence:0});
  if(result.technicalQa.sha256!==replay.technicalQa.sha256)throw Error('PICTURE_SEQUENCE_REPLAY_CHANGED');
  const first=await pixel(image,result.outputPath,5),second=await pixel(image,result.outputPath,15);
  if(first[0]<120||first[2]>80||second[2]<120||second[0]>80)throw Error(`PICTURE_SEQUENCE_ORDER_CHANGED: ${first} ${second}`);
  const evidence={technicalProbeOnly:true,shots:clips,stageKey:result.stageKey,technicalQa:result.technicalQa,centerPixelAt5Seconds:first,centerPixelAt15Seconds:second,replayIdentical:true,limits:'Two synthetic 320x180 Docker scenes; no model output, user assets, 1080p, style QA, audio, subtitles or preview publication.'};
  if(process.argv.includes('--record'))await writeFile('docs/engineering/evidence/picture-sequence-probe.json',JSON.stringify(evidence,null,2)+'\n');
  process.stdout.write(JSON.stringify(evidence)+'\n');
 }finally{for(const name of containers)await docker(['rm','--force',name],false).catch(()=>{});await rm(root,{recursive:true,force:true})}
}
main().catch(error=>{console.error(error instanceof Error?error.message:'PICTURE_SEQUENCE_PROBE_FAILED');process.exitCode=1});
