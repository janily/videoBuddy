import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {copyFile,mkdtemp,mkdir,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {computeStageKey,DockerExecutor} from '../../src/services/video/media/docker-executor';
import {prepareNarration} from '../../src/services/video/audio/narration';
import {verifyNarration} from '../../src/services/video/audio/asr';
import {buildNarrationTrack} from '../../src/services/video/audio/mix';
import {compileSubtitles,readPinnedSubtitleFont} from '../../src/services/video/audio/subtitles';
import {composeVideo} from '../../src/services/video/media/compose';
import {verifyPostMixNarration} from '../../src/services/video/audio/postmix-asr';
import {measureFinalLoudness} from '../../src/services/video/audio/loudness';

async function docker(args:string[]){
 const child=spawn('docker',args,{stdio:['ignore','pipe','pipe'],signal:AbortSignal.timeout(120000)}),out:Buffer[]=[],err:Buffer[]=[];
 child.stdout.on('data',(part:Buffer)=>{if(Buffer.concat(out).length<8192)out.push(part)});
 child.stderr.on('data',(part:Buffer)=>{if(Buffer.concat(err).length<4096)err.push(part)});
 const code=await new Promise<number>((resolve,reject)=>{child.once('error',reject);child.once('close',value=>resolve(value??1))});
 if(code!==0)throw Error(`PROBE_DOCKER_FAILED: ${Buffer.concat(err).toString('utf8').slice(0,300)}`);
 return Buffer.concat(out).toString('utf8').trim();
}
async function extractFrame(image:string,source:string,destination:string,seconds:number){
 await docker(['run','--rm','--network','none','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges','--user',`${process.getuid?.()??10001}:${process.getgid?.()??10001}`,'--mount',`type=bind,src=${source},dst=/input/video.mp4,readonly`,'--mount',`type=bind,src=${destination},dst=/output/frame.png`,image,'ffmpeg','-hide_banner','-loglevel','error','-nostdin','-y','-i','/input/video.mp4','-ss',String(seconds),'-frames:v','1','/output/frame.png']);
}
async function main(){
 const image=process.env.VIDEO_MEDIA_IMAGE_REF,digest=process.env.VIDEO_MEDIA_RUNTIME_DIGEST;
 if(!image||!digest||image!==`sha256:${digest}`)throw Error('CONFIGURATION_REQUIRED: pinned media image');
 const root=await mkdtemp(join(tmpdir(),'vb-composition-probe-'));
 const executor=new DockerExecutor(root);
 const sourceHtml='<!doctype html><meta charset="utf-8"><body style="margin:0;background:#18304a"><canvas id="c" width="320" height="180"></canvas><script>const c=document.getElementById("c"),x=c.getContext("2d");window.render=t=>{x.fillStyle="#18304a";x.fillRect(0,0,320,180);x.fillStyle="#dfb65b";x.fillRect(20+100*Math.sin(t/3),50,35,35);x.fillStyle="#fff";x.font="bold 22px sans-serif";x.fillText("上海活动",20,35)};window.READY=true;</script>';
 const params={projectId:'composition_probe',bundleHash:'a'.repeat(64),runtimeDigest:digest,sourceHtml,logicalWidth:320,logicalHeight:180,outputWidth:320,outputHeight:180,fps:24 as const,startFrame:0,endFrame:480,seed:1,fence:1};
 const stageKey=computeStageKey(params);let containerName:string|undefined;
 try{
  const handle=await executor.submit({...params,operationId:randomUUID(),attemptId:'one',stageKey});containerName=handle.containerName;
  const deadline=Date.now()+240000;let status=await executor.inspect(handle);
  while(status.status==='running'&&Date.now()<deadline){await new Promise(resolve=>setTimeout(resolve,1000));status=await executor.inspect(handle)}
  if(status.status!=='succeeded')throw Error(`PICTURE_PROBE_FAILED: ${JSON.stringify(status)}`);
  const originalPlan={durationMs:20000,lines:[
   {lineId:'composition_zh',language:'zh-CN' as const,spokenText:'上海的活动将在十月八日开始。',displayText:'上海的活动将在十月八日开始。',expectedAsrText:'上海的活动将在十月八日开始',startMs:1000,reservedMs:6000},
   {lineId:'composition_en',language:'en' as const,spokenText:'The event starts in Shanghai.',displayText:'The event starts in Shanghai.',expectedAsrText:'The event starts in Shanghai',startMs:9000,reservedMs:6000},
  ]};
  const narration=await prepareNarration(originalPlan,root),verified=await verifyNarration(originalPlan,narration,root);
  const track=await buildNarrationTrack(root,narration),font=await readPinnedSubtitleFont(),cues=compileSubtitles(verified,24,font.glyphs);
  const film=await composeVideo(root,join(root,'media',stageKey),track,cues,{fontSize:42,marginV:12,outline:2,primary:'#FFFFFF',outlineColor:'#000000'},{width:320,height:180,durationSec:20,fps:24,bundleHash:params.bundleHash,fence:params.fence});
  const postMixAsr=await verifyPostMixNarration(root,{outputPath:film.outputPath,sha256:film.technicalQa.sha256,durationMs:20000,technicalQa:'pass'},originalPlan,verified,process.env,(lineId,recognizedText)=>console.error(JSON.stringify({lineId,recognizedText})));
  const loudness=await measureFinalLoudness(root,{outputPath:film.outputPath,sha256:film.technicalQa.sha256,durationMs:20000,technicalQa:'pass'},false);
  const silentNarration=await prepareNarration({durationMs:20000,lines:[]},root),silentTrack=await buildNarrationTrack(root,silentNarration);
  const silentFilm=await composeVideo(root,join(root,'media',stageKey),silentTrack,[],null,{width:320,height:180,durationSec:20,fps:24,bundleHash:params.bundleHash,fence:params.fence});
  if(!silentTrack.wav.silence||!silentFilm.technicalQa.audio)throw Error('SILENT_COMPOSITION_INVALID');
  const silentPlan={durationMs:20000,lines:[]};
  const postMixSilence=await verifyPostMixNarration(root,{outputPath:silentFilm.outputPath,sha256:silentFilm.technicalQa.sha256,durationMs:20000,technicalQa:'pass'},silentPlan,{durationMs:20000,lines:[]});
  const silentLoudness=await measureFinalLoudness(root,{outputPath:silentFilm.outputPath,sha256:silentFilm.technicalQa.sha256,durationMs:20000,technicalQa:'pass'},true);
  const frameDir=join(root,'frames');await mkdir(frameDir);
  const frames=[{time:2,name:'composition-caption-zh.png'},{time:7,name:'composition-caption-gap.png'},{time:10,name:'composition-caption-en.png'}];
  for(const frame of frames){const path=join(frameDir,frame.name);await writeFile(path,'');await extractFrame(image,film.outputPath,path,frame.time);if(process.argv.includes('--record'))await copyFile(path,join('docs/engineering/evidence',frame.name))}
  const evidence={mediaRuntimeDigest:digest,voiceRuntimeDigest:narration.lines[0].voice.runtimeDigest,asrRuntimeDigest:process.env.VIDEO_ASR_RUNTIME_DIGEST,sourceKind:'deterministic technical scene; not a model-generated user film',pictureStageKey:stageKey,trackSha256:track.wav.sha256,subtitleCues:cues.map(cue=>({lineId:cue.lineId,startFrame:cue.startFrame,endFrame:cue.endFrame,text:cue.text})),fontCharsetSha256:font.charsetSha256,output:{sha256:film.technicalQa.sha256,bytes:film.technicalQa.bytes,width:film.technicalQa.width,height:film.technicalQa.height,durationSec:film.technicalQa.durationSec,fps:film.technicalQa.fps,audio:film.technicalQa.audio,qaStatus:film.qaStatus},postMixAsr,loudness,intentionalSilence:{trackSilent:silentTrack.wav.silence,outputSha256:silentFilm.technicalQa.sha256,bytes:silentFilm.technicalQa.bytes,durationSec:silentFilm.technicalQa.durationSec,audio:silentFilm.technicalQa.audio,postMixSilence,loudness:silentLoudness,qaStatus:silentFilm.qaStatus},limits:'Technical 320x180 composition and independent full decode plus post-mix ASR/silence and loudness measurement only; no 1080p, style baseline, listening or semantic QA'};
  if(process.argv.includes('--record'))await writeFile('docs/engineering/evidence/composition-probe.json',JSON.stringify(evidence,null,2)+'\n');
  process.stdout.write(JSON.stringify(evidence)+'\n');
 }finally{
  if(containerName)await docker(['rm','--force',containerName]).catch(()=>{});
  await rm(root,{recursive:true,force:true});
 }
}
main().catch(error=>{console.error(error);process.exitCode=1});
