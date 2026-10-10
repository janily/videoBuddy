/** Real T3 implementation, including its validation, durable writes and hashes. */
import {readFile} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {dirname,join} from 'node:path';
import {availableParallelism} from 'node:os';
import type {RuntimeBenchAdapter} from '../../../../scripts/video/bench-runtime';
import {createLocalRuntime} from '../../../../src/services/video/media/local';
import {computeStageKey,type MediaJob} from '../../../../src/services/video/media/runtime';
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
 const runtime=await createLocalRuntime({root:join(input.outputDir,'store'),fontsDir,frameFormat:input.capture as 'png'|'jpeg',env:{NODE_ENV:input.unsafeNoSandbox?'development':'production',VIDEO_UNSAFE_NO_SANDBOX:input.unsafeNoSandbox?'1':undefined,VIDEO_CHROMIUM_EXECUTABLE_PATH:input.chromiumExecutable,VIDEO_FFMPEG_PATH:input.ffmpegPath,VIDEO_FFPROBE_PATH:input.ffprobePath}});
 const startupMs=performance.now()-start,shotTimings:number[]=[],availableCpus=availableParallelism(),rendererConcurrency=Math.max(1,Math.min(4,Math.floor(availableCpus/2)));
 try{
  const shots=await Promise.all(Array.from({length:input.spec.shots},async(_,shot)=>{
   const at=performance.now(),partial={projectId,operationId:randomUUID(),attemptId:randomUUID(),bundleHash:sourceHash,runtimeDigest:runtime.runtimeDigest,sourceHtml,logicalWidth:input.spec.width,logicalHeight:input.spec.height,outputWidth:input.spec.width,outputHeight:input.spec.height,fps:input.spec.fps,startFrame:shot*input.spec.framesPerShot,endFrame:(shot+1)*input.spec.framesPerShot,seed:42,fence:1};
   const job:MediaJob={...partial,stageKey:computeStageKey(partial)};
   const clip=await runtime.renderShot(job);shotTimings[shot]=performance.now()-at;return clip;
  }));
  const shotsMs=performance.now()-start;
  const assemblyStart=performance.now(),final=await runtime.assemble({projectId,clips:shots,music:null,title:'VideoBuddy fixed runtime benchmark'}),assembleMs=performance.now()-assemblyStart;
  // close() is included in total wall time, like the reconstructed baseline.
  await runtime.close();
  return{outputPath:final.outputPath,timing:{shotsMs:Math.round(shotsMs),captureMs:null,concatMs:0,assembleMs:Math.round(assembleMs),totalMs:Math.round(performance.now()-start)},details:{runtimeDigest:runtime.runtimeDigest,version:runtime.version,sourceSha256:sourceHash,fontSha256:fontHash,startupMs:Math.round(startupMs),perShotMs:shotTimings.map(Math.round),qa:'All runtime shot/final QA, cache manifest hashing and durable publication included; fresh project/output prevents cache hits.',captureTiming:'Not exposed by MediaRuntime; null rather than estimated.',shotDispatch:'Promise.all with input-order clip assembly',submittedShotConcurrency:input.spec.shots,rendererConcurrency,rendererConcurrencyPolicy:'factory default: max(1,min(4,floor(availableParallelism()/2)))',availableParallelism:availableCpus,encoderThreadsPerShot:2,perShotTimingIncludesPoolQueue:true}};
 }finally{await runtime.close()}
};
