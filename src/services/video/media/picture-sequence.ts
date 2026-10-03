import {runOwnedDocker} from './owned-docker';
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

export async function assemblePictureSequence(root:string,input:PictureSequenceInput,env:Environment=process.env,options:{assertActive?:()=>Promise<void>;mustExist?:boolean}={}){
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
 if(!options.mustExist)await mkdir(outputDir,{recursive:true,mode:0o700});
 let exists=false;try{await lstat(outputPath);exists=true}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error}
 await options.assertActive?.();
 if(!exists&&options.mustExist)throw Error('PICTURE_SEQUENCE_MISSING');
 if(!exists)await runOwnedDocker(pictureSequenceDockerArguments(config.image,config.user,stageKey,outputDir,sourcePaths,input.shots,input.fps),config.timeoutSeconds*1000,config.image,options.assertActive);
 await options.assertActive?.();
 const technicalQa=await technicalVideoQa(stageDir,config.image,'output/picture.mp4',{width:input.width,height:input.height,durationSec:totalFrames/input.fps,fps:input.fps,audio:false});
 return{stageKey,outputPath,technicalQa,totalFrames};
}
