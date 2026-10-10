/**
 * Dry run: npx tsx scripts/video/style-samples.ts
 * Paid execution: npx tsx scripts/video/style-samples.ts --execute --styles=watercolor
 * Requires the normal enabled model, budget and pinned Docker configuration.
 * Uses a fixed, non-personal theme. Review the outputs before shipping all 43.
 */
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {isAbsolute,join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
import {initialUnderstanding} from '../../src/contracts/video/domain';
import {guardTreatment,type TreatmentPlan} from '../../src/contracts/video/treatment';
import type {VisualShotSource} from '../../src/contracts/video/visual-shot';
import {runTreatment} from '../../src/mastra/video/treatment';
import {guardQuickVisualShot,quickClock,runQuickVisualShot} from '../../src/mastra/video/visual-shot';
import {configuredModel} from '../../src/mastra/video/model-adapter';
import {listStyles} from '../../src/services/video/styles/registry';
import {loadStageKnowledge} from '../../src/services/video/styles/knowledge-loader';
import {canonicalHash,canonicalJson} from '../../src/services/video/domain/hash';
import {readConfiguration,requireGeneration,type Environment} from '../../src/services/video/config/environment';
import {FileStore} from '../../src/services/video/storage/file-store';
import {createOrRead,StoreMissing} from '../../src/services/video/storage/atomic-store';
import {modelLimits,reserveModelBudget} from '../../src/services/video/budget/model-budget';
import {withAccountedModel} from '../../src/services/video/budget/model-call';
import {computeStageKey,DockerExecutor,dockerConfiguration} from '../../src/services/video/media/docker-executor';
import {technicalVideoQa} from '../../src/services/video/media/technical-qa';
import {runOwnedDocker} from '../../src/services/video/media/owned-docker';
import {aiLabel} from '../../src/services/video/quick/compose';

export function parseSampleOptions(args:string[]){
 let execute=false,styles=listStyles().map(style=>style.id),output=resolve('public/style-samples');
 for(const arg of args){if(arg==='--execute')execute=true;else if(arg.startsWith('--styles='))styles=arg.slice(9).split(',');else if(arg.startsWith('--output='))output=resolve(arg.slice(9));else throw Error('Unknown option: '+arg)}
 if(!/^\/[A-Za-z0-9_./-]+$/.test(output))throw Error('Output path must use only letters, numbers, underscore, dot, dash and slash');
 if(!styles.length||new Set(styles).size!==styles.length||styles.some(id=>!listStyles().some(style=>style.id===id)))throw Error('Unknown or duplicate style');
 return{execute,styles,output};
}
export function sampleExportArguments(image:string,user:string,picturePath:string,outputDir:string,id:string,sourceDuration:number){
 const safe=(path:string)=>isAbsolute(path)&&/^\/[A-Za-z0-9_./-]+$/.test(path);
 if(!/^sha256:[a-f0-9]{64}$/.test(image)||!/^\d+:\d+$/.test(user)||!safe(picturePath)||!safe(outputDir)||!listStyles().some(style=>style.id===id)||!Number.isFinite(sourceDuration)||sourceDuration<=0)throw Error('SAMPLE_EXPORT_INVALID');
 const label=`drawtext=fontfile=${aiLabel.font}:text=${aiLabel.text}:fontcolor=white:fontsize=h*0.03:box=1:boxcolor=black@0.3:x=w-tw-20:y=20`;
 return['run','--rm','--name',`vb-sample-${id}-${randomUUID().slice(0,8)}`,'--network','none','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges','--pids-limit','128','--cpus','2','--memory','1g','--user',user,'--tmpfs','/tmp:rw,nosuid,size=64m','--mount',`type=bind,src=${picturePath},dst=/input/picture.mp4,readonly`,'--mount',`type=bind,src=${outputDir},dst=/output`,image,
 'ffmpeg','-hide_banner','-loglevel','error','-nostdin','-y','-i','/input/picture.mp4','-ss',String(sourceDuration/2),'-frames:v','1','-vf',label,'-q:v','2',`/output/${id}.jpg`,
 '-map','0:v:0','-vf',`tpad=stop_mode=clone:stop_duration=6,${label}`,'-t','6','-an','-c:v','libx264','-pix_fmt','yuv420p','-movflags','+faststart','-metadata',`comment=${aiLabel.metadata}`,`/output/${id}.mp4`];
}
async function generateSample(id:string,output:string,env:Environment){
 const root=env.VIDEO_DATA_DIR!;if(!root||!isAbsolute(root))throw Error('CONFIGURATION_REQUIRED: VIDEO_DATA_DIR');
 const store=new FileStore(root),knowledge=await loadStageKnowledge(id,'style');
 const understanding=initialUnderstanding();understanding.briefVersion=1;understanding.subject='一颗种子在阳光下发芽，长成一株绿植';understanding.audience='普通观众';understanding.objective='用温暖、清晰的画面介绍生长的过程';understanding.summary=['种子落入土中，嫩芽伸展，叶片迎向阳光。','第一镜约 6 秒，主体清晰，无品牌、无人物姓名。'];understanding.preferences={...understanding.preferences,durationSec:20,aspect:'16:9',styleSlug:id,voiceMode:'none',musicMode:'none',captions:'none'};
 const hash=canonicalHash({kind:'style-sample-v1',understanding,rules:knowledge.sha256});
 const projectId=`style-sample-${hash.slice(0,32)}`,prefix=`projects/${projectId}/sample`,limits=modelLimits(env),operationId=randomUUID();
 async function cached<T>(key:string,create:()=>Promise<T>):Promise<T>{try{return(await store.readFresh<{value:T}>(key)).value.value}catch(error){if(!(error instanceof StoreMissing))throw error}return(await createOrRead(store,key,{value:await create()})).value}
 const contextBytes=Buffer.byteLength(canonicalJson({understanding,rules:knowledge.rules}));
 const treatment:TreatmentPlan=guardTreatment(await cached(`${prefix}/treatment`,async()=>{
  const reservation=await reserveModelBudget(store,projectId,`sample-treatment-${randomUUID()}`,{inputTokens:contextBytes+4096,outputTokens:5000},limits);
  return withAccountedModel(store,reservation.reservation,()=>runTreatment(understanding,reservation.maxOutputTokens,env));
 }),understanding,knowledge.sha256);
 const shot=treatment.shots[0],seed=Number.parseInt(hash.slice(0,8),16);
 const source:VisualShotSource=guardQuickVisualShot(await cached(`${prefix}/source`,async()=>{
  const reservation=await reserveModelBudget(store,projectId,`sample-visual-${randomUUID()}`,{inputTokens:contextBytes+Buffer.byteLength(canonicalJson(treatment))+4096,outputTokens:12000},limits);
  return withAccountedModel(store,reservation.reservation,()=>runQuickVisualShot(understanding,treatment,shot.id,{env,seed,maxOutputTokens:reservation.maxOutputTokens}));
 }),understanding,treatment,canonicalHash(quickClock(treatment)),seed);
 const config=dockerConfiguration(env,operationId);
 const parameters={projectId,bundleHash:canonicalHash(source),runtimeDigest:config.runtimeDigest,sourceHtml:source.sourceHtml,logicalWidth:1920,logicalHeight:1080,outputWidth:1280,outputHeight:720,fps:treatment.fps,startFrame:source.startFrame,endFrame:source.endFrame,seed,fence:0};
 const stageKey=computeStageKey(parameters),stageDir=join(root,'media',stageKey),durationSec=(source.endFrame-source.startFrame)/treatment.fps,expected={width:1280,height:720,fps:treatment.fps,durationSec,audio:false};
 if(!await technicalVideoQa(stageDir,config.image,'output/picture.mp4',expected).catch(()=>null)){
  const executor=new DockerExecutor(root,env),handle=await executor.submit({...parameters,stageKey,operationId,attemptId:'sample'}),deadline=Date.now()+config.timeoutSeconds*1000+30000;
  let state=await executor.inspect(handle);
  while(state.status==='running'&&Date.now()<deadline){await new Promise(resolve=>setTimeout(resolve,1000));state=await executor.inspect(handle)}
  if(state.status==='running'){await executor.cancel(handle);throw Error('PICTURE_RENDER_FAILED: timeout')}
  if(state.status!=='succeeded')throw Error('PICTURE_RENDER_FAILED');
 }
 await technicalVideoQa(stageDir,config.image,'output/picture.mp4',expected);
 await mkdir(output,{recursive:true});
 await runOwnedDocker(sampleExportArguments(config.image,config.user,join(stageDir,'output/picture.mp4'),output,id,durationSec),config.timeoutSeconds*1000,config.image);
 const jpg=await readFile(join(output,`${id}.jpg`)),mp4=await readFile(join(output,`${id}.mp4`));
 if(!jpg.length||!mp4.length)throw Error('SAMPLE_EXPORT_INVALID');
 return{id,inputHash:hash,sourceDurationSec:durationSec,sampleDurationSec:6,posterBytes:jpg.length,videoBytes:mp4.length,review:'pending' as const};
}
export async function runStyleSamples(args=process.argv.slice(2),env:Environment=process.env){
 const options=parseSampleOptions(args);
 if(!options.execute){console.log(JSON.stringify({...options,mode:'dry-run',modelCallsAtMost:options.styles.length*2,theme:'一颗种子在阳光下发芽，长成一株绿植',note:'Use --execute to spend model budget and render. Review generated samples before release.'},null,2));return}
 requireGeneration(readConfiguration(env));configuredModel('director',env);configuredModel('visual',env);dockerConfiguration(env,'style-samples');
 for(const id of options.styles){console.log(`Generating ${id}`);const sample=await generateSample(id,options.output,env);await writeFile(join(options.output,`${id}.review.json`),JSON.stringify(sample,null,2));console.log(`Ready for review: ${id}`)}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)runStyleSamples().catch(error=>{console.error(error instanceof Error?error.message:'SAMPLE_FAILED');process.exitCode=1});
