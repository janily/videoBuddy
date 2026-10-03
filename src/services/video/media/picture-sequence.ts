import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {lstat,mkdir} from 'node:fs/promises';
import {isAbsolute,join} from 'node:path';
import type {Environment} from '@/services/video/config/environment';
import {canonicalHash} from '@/services/video/domain/hash';
import {dockerConfiguration} from './docker-executor';
import {technicalVideoQa} from './technical-qa';

const digest=/^[a-f0-9]{64}$/;
export interface PictureClip{shotId:string;startFrame:number;endFrame:number;stageKey:string;sha256:string}
export interface PictureSequenceInput{projectId:string;revisionId:string;shots:PictureClip[];width:number;height:number;fps:24|30|60;runtimeDigest:string;fence:number}

export function validatePictureSequence(input:PictureSequenceInput){
 if(!input.projectId||!input.revisionId||!digest.test(input.runtimeDigest)||!Number.isSafeInteger(input.fence)||input.fence<0||![24,30,60].includes(input.fps)||
  ![input.width,input.height].every(value=>Number.isSafeInteger(value)&&value>=64&&value<=3840&&value%2===0)||input.shots.length<1||input.shots.length>80)throw Error('PICTURE_SEQUENCE_INVALID');
 let cursor=0;const ids=new Set<string>();
 for(const shot of input.shots){
  if(!shot.shotId||ids.has(shot.shotId)||!digest.test(shot.stageKey)||!digest.test(shot.sha256)||!Number.isSafeInteger(shot.startFrame)||!Number.isSafeInteger(shot.endFrame)||shot.startFrame!==cursor||shot.endFrame<=cursor)throw Error('PICTURE_SEQUENCE_INVALID');
  ids.add(shot.shotId);cursor=shot.endFrame;
 }
 if(cursor<input.fps*20||cursor>input.fps*120)throw Error('PICTURE_SEQUENCE_INVALID');
 return cursor;
}
export function pictureSequenceStageKey(input:PictureSequenceInput){validatePictureSequence(input);return canonicalHash({...input,version:'picture-sequence-v1'})}

export function pictureSequenceDockerArguments(image:string,user:string,key:string,outputDir:string,sourcePaths:string[],shots:PictureClip[],fps:24|30|60){
 if(!/^sha256:[a-f0-9]{64}$/.test(image)||!/^[0-9]+:[0-9]+$/.test(user)||!digest.test(key)||!isAbsolute(outputDir)||!/^\/[A-Za-z0-9_./-]+$/.test(outputDir)||sourcePaths.length!==shots.length)throw Error('PICTURE_SEQUENCE_INVALID');
 const totalFrames=validatePictureSequence({projectId:'job',revisionId:'job',shots,width:320,height:180,fps,runtimeDigest:image.slice(7),fence:0});
 for(const [index,path] of sourcePaths.entries())if(!isAbsolute(path)||!/^\/[A-Za-z0-9_./-]+$/.test(path)||!path.endsWith(`/media/${shots[index].stageKey}/output/picture.mp4`))throw Error('PICTURE_SEQUENCE_INVALID');
 const filters=shots.map((shot,index)=>`[${index}:v]trim=start_frame=0:end_frame=${shot.endFrame-shot.startFrame},setpts=PTS-STARTPTS[v${index}]`);
 filters.push(`${shots.map((_,index)=>`[v${index}]`).join('')}concat=n=${shots.length}:v=1:a=0[v]`);
 const args=['run','--rm','--network','none','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges','--pids-limit','128','--cpus','4','--memory','4g','--memory-swap','4g','--user',user,'--tmpfs','/tmp:rw,nosuid,size=128m'];
 for(const [index,path] of sourcePaths.entries())args.push('--mount',`type=bind,src=${path},dst=/input/${index}.mp4,readonly`);
 args.push('--mount',`type=bind,src=${outputDir},dst=/output`,image,'ffmpeg','-hide_banner','-loglevel','error','-xerror','-nostdin','-y','-threads','2','-filter_threads','2');
 for(let index=0;index<sourcePaths.length;index++)args.push('-i',`/input/${index}.mp4`);
 args.push('-filter_complex',filters.join(';'),'-map','[v]','-an','-frames:v',String(totalFrames),'-r',String(fps),'-c:v','libx264','-preset','medium','-crf','18','-pix_fmt','yuv420p','-color_primaries','bt709','-color_trc','bt709','-colorspace','bt709','-movflags','+faststart','/output/picture.mp4');
 return args;
}

async function runDocker(args:string[],timeoutMs:number,image:string,assertActive?:()=>Promise<void>){
 const invocation=randomUUID(),name='vb-sequence-'+invocation;
 const child=spawn('docker',[...args.slice(0,1),'--name',name,'--label','videobuddy.invocation='+invocation,...args.slice(1)],{stdio:['ignore','ignore','pipe'],signal:AbortSignal.timeout(timeoutMs)}),errors:Buffer[]=[];let size=0;
 child.stderr.on('data',(part:Buffer)=>{size+=part.length;if(size<=8192)errors.push(part)});
 let closed=false,interruption:unknown,pending=Promise.resolve();child.once('close',()=>{closed=true});
 async function command(commandArgs:string[]){
  const task=spawn('docker',commandArgs,{stdio:['ignore','pipe','ignore'],signal:AbortSignal.timeout(15000)}),chunks:Buffer[]=[];
  task.stdout.on('data',(chunk:Buffer)=>{if(Buffer.concat(chunks).length<2048)chunks.push(chunk)});
  const code=await new Promise<number>((resolve,reject)=>{task.once('error',reject);task.once('close',value=>resolve(value??1))});
  if(code!==0)throw Error('PICTURE_SEQUENCE_STOP_UNKNOWN');return Buffer.concat(chunks).toString('utf8').trim();
 }
 async function stop(){
  const deadline=Date.now()+5000;
  while(Date.now()<deadline){
   const identity=await command(['inspect','--format','{{.Id}} {{.Image}} {{index .Config.Labels "videobuddy.invocation"}}',name]).catch(()=>null);
   if(identity){const [id,actualImage,label]=identity.split(' ');if(actualImage!==image||label!==invocation)throw Error('PICTURE_SEQUENCE_STOP_UNKNOWN');await command(['stop','--time','10',id]);return}
   if(closed)return;
   await new Promise(resolve=>setTimeout(resolve,100));
  }
  throw Error('PICTURE_SEQUENCE_STOP_UNKNOWN');
 }
 const monitor=assertActive?setInterval(()=>{pending=pending.then(async()=>{if(interruption||closed)return;try{await assertActive()}catch(error){interruption=error;await stop()}}).catch(error=>{interruption ||=error})},500):undefined;
 try{
  const code=await new Promise<number>((resolve,reject)=>{child.once('error',reject);child.once('close',value=>resolve(value??1))});
  if(monitor)clearInterval(monitor);await pending;
  if(interruption)throw interruption;
  if(code!==0)throw Error(`PICTURE_SEQUENCE_FAILED: docker exit ${code}; ${Buffer.concat(errors).toString('utf8').slice(0,300)}`);
 }catch(error){await stop().catch(()=>undefined);throw error}
 finally{if(monitor)clearInterval(monitor);await pending}
}
export async function assemblePictureSequence(root:string,input:PictureSequenceInput,env:Environment=process.env,options:{assertActive?:()=>Promise<void>}={}){
 if(!isAbsolute(root)||!/^\/[A-Za-z0-9_./-]+$/.test(root))throw Error('PICTURE_SEQUENCE_INVALID');
 const totalFrames=validatePictureSequence(input),config=dockerConfiguration(env,'picture-sequence');
 if(config.runtimeDigest!==input.runtimeDigest)throw Error('PICTURE_SEQUENCE_INVALID');
 const sourcePaths:string[]=[];
 for(const shot of input.shots){
  const stageDir=join(root,'media',shot.stageKey),sourcePath=join(stageDir,'output','picture.mp4');
  const qa=await technicalVideoQa(stageDir,config.image,'output/picture.mp4',{width:input.width,height:input.height,durationSec:(shot.endFrame-shot.startFrame)/input.fps,fps:input.fps,audio:false});
  if(qa.sha256!==shot.sha256)throw Error('PICTURE_SOURCE_CHANGED');
  sourcePaths.push(sourcePath);
 }
 const stageKey=pictureSequenceStageKey(input),stageDir=join(root,'picture-sequence',stageKey),outputDir=join(stageDir,'output'),outputPath=join(outputDir,'picture.mp4');
 await mkdir(outputDir,{recursive:true,mode:0o700});
 let exists=false;try{await lstat(outputPath);exists=true}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error}
 await options.assertActive?.();
 if(!exists)await runDocker(pictureSequenceDockerArguments(config.image,config.user,stageKey,outputDir,sourcePaths,input.shots,input.fps),config.timeoutSeconds*1000,config.image,options.assertActive);
 await options.assertActive?.();
 const technicalQa=await technicalVideoQa(stageDir,config.image,'output/picture.mp4',{width:input.width,height:input.height,durationSec:totalFrames/input.fps,fps:input.fps,audio:false});
 return{stageKey,outputPath,technicalQa,totalFrames};
}
