/** Real T3 implementation, including its validation, durable writes and hashes. */
import {readFile} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {dirname,join} from 'node:path';
import type {RuntimeBenchAdapter} from '../../../../scripts/video/bench-runtime';
import {createLocalRuntime} from '../../../../src/services/video/media/local';
import {computeStageKey,type MediaJob,type RenderedVideo} from '../../../../src/services/video/media/runtime';
import {encoderPolicy} from '../../../../src/services/video/media/local/arguments';

export const runRuntimeBenchmark:RuntimeBenchAdapter=async input=>{
 if(input.encode.preset!==encoderPolicy.preset||input.encode.crf!==encoderPolicy.crf||input.encode.threads!==2||input.encode.gop!==input.spec.fps*2)throw Error('BENCH_ENCODER_POLICY_MISMATCH');
 if(!['png','jpeg'].includes(input.capture))throw Error('Actual runtime supports png/jpeg capture only.');
 const fontsDir=dirname(dirname(input.fontPath)),lock=JSON.parse(await readFile(join(fontsDir,'fonts.lock.json'),'utf8')) as {fonts:Array<{id:string;font:{sha256:string}}>};
 const fontHash=createHash('sha256').update(await readFile(input.fontPath)).digest('hex');
 if(lock.fonts.find(font=>font.id==='notosanssc')?.font.sha256!==fontHash)throw Error('BENCH_FONT_MISMATCH');
 // Use the runtime's local resource server, with the same font and exact scene.
 // Font readiness is part of shot wall time, not hidden outside measurement.
 const sourceHtml=(await readFile(input.scenePath,'utf8')).replace('"Noto Sans CJK SC"','"Noto Sans SC"').replace('window.READY=true;',`document.fonts.load('80px "Noto Sans SC"').then(()=>{window.READY=true});`);
 const sourceHash=createHash('sha256').update(sourceHtml).digest('hex'),projectId=randomUUID(),start=performance.now();
 const runtime=await createLocalRuntime({root:join(input.outputDir,'store'),fontsDir,frameFormat:input.capture as 'png'|'jpeg',concurrency:1,env:{NODE_ENV:input.unsafeNoSandbox?'development':'production',VIDEO_UNSAFE_NO_SANDBOX:input.unsafeNoSandbox?'1':undefined,VIDEO_CHROMIUM_EXECUTABLE_PATH:input.chromiumExecutable,VIDEO_FFMPEG_PATH:input.ffmpegPath,VIDEO_FFPROBE_PATH:input.ffprobePath}});
 const startupMs=performance.now()-start,shots:RenderedVideo[]=[],shotTimings:number[]=[];
 try{
  for(let shot=0;shot<input.spec.shots;shot++){
   const at=performance.now(),partial={projectId,operationId:randomUUID(),attemptId:randomUUID(),bundleHash:sourceHash,runtimeDigest:runtime.runtimeDigest,sourceHtml,logicalWidth:input.spec.width,logicalHeight:input.spec.height,outputWidth:input.spec.width,outputHeight:input.spec.height,fps:input.spec.fps,startFrame:shot*input.spec.framesPerShot,endFrame:(shot+1)*input.spec.framesPerShot,seed:42,fence:1};
   const job:MediaJob={...partial,stageKey:computeStageKey(partial)};
   shots.push(await runtime.renderShot(job));shotTimings.push(performance.now()-at);
  }
  const assemblyStart=performance.now(),final=await runtime.assemble({projectId,clips:shots,music:null,title:'VideoBuddy fixed runtime benchmark'}),assembleMs=performance.now()-assemblyStart;
  // close() is included in total wall time, like the reconstructed baseline.
  await runtime.close();
  return{outputPath:final.outputPath,timing:{shotsMs:Math.round(startupMs+shotTimings.reduce((a,b)=>a+b,0)),captureMs:null,concatMs:0,assembleMs:Math.round(assembleMs),totalMs:Math.round(performance.now()-start)},details:{runtimeDigest:runtime.runtimeDigest,version:runtime.version,sourceSha256:sourceHash,fontSha256:fontHash,startupMs:Math.round(startupMs),perShotMs:shotTimings.map(Math.round),qa:'All runtime shot/final QA, cache manifest hashing and durable publication included; fresh project/output prevents cache hits.',captureTiming:'Not exposed by MediaRuntime; null rather than estimated.',parallelism:1}};
 }finally{await runtime.close()}
};
