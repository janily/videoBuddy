import {createHash} from 'node:crypto';
import {constants} from 'node:fs';
import {readFile,mkdir,lstat,open} from 'node:fs/promises';
import {isAbsolute,join} from 'node:path';
import {z} from 'zod';
import {sourceImageJob,guardSourceImageReceipt,type SourceImageJob} from '@/contracts/video/source-image';
import type {Environment} from '@/services/video/config/environment';
import {dockerConfiguration,writeStageInputs} from '@/services/video/media/docker-executor';
import type {DockerJournal} from '@/services/video/media/docker-journal';
import {runOwnedDocker} from '@/services/video/media/owned-docker';
import {prepareRuntimeAssets,verifyRuntimeAssets} from '@/services/video/media/runtime-assets';
const Input=z.strictObject({projectId:z.uuid(),assetId:z.uuid(),sourceMime:z.enum(['image/png','image/jpeg','image/webp']),sourceSha256:z.string().regex(/^[a-f0-9]{64}$/),sourceBytes:z.number().int().positive().max(20*1024*1024)});
export type SourceImageInput=z.infer<typeof Input>;
export async function sourceImageProducerSha(){return createHash('sha256').update(await readFile(join(process.cwd(),'runtime/media/prepare-image.mjs'))).digest('hex')}
async function directory(path:string){const stat=await lstat(path);if(!stat.isDirectory()||stat.isSymbolicLink())throw Error('SOURCE_IMAGE_CHANGED')}
async function outputBytes(dir:string,receipt:Extract<ReturnType<typeof guardSourceImageReceipt>,{status:'pass'}>){
 await directory(dir);await directory(join(dir,'output'));const file=await open(join(dir,'output/view.png'),constants.O_RDONLY|constants.O_NOFOLLOW);
 try{const stat=await file.stat();if(!stat.isFile()||stat.nlink!==1||stat.size!==receipt.bytes)throw Error('SOURCE_IMAGE_CHANGED');const data=await file.readFile();if(data.length<24||data.length!==receipt.bytes||createHash('sha256').update(data).digest('hex')!==receipt.sha256||data.subarray(0,8).toString('hex')!=='89504e470d0a1a0a'||data.toString('ascii',12,16)!=='IHDR'||data.readUInt32BE(16)!==receipt.width||data.readUInt32BE(20)!==receipt.height)throw Error('SOURCE_IMAGE_CHANGED');return data}finally{await file.close()}
}
export async function prepareSourceImage(root:string,raw:SourceImageInput,options:{env?:Environment;journal:DockerJournal;assertActive:()=>Promise<void>}){
 await options.assertActive();const parsed=Input.safeParse(raw);if(!parsed.success||!isAbsolute(root)||/[\u0000-\u001f,]/.test(root))throw Error('SOURCE_IMAGE_INPUT_INVALID');const input=parsed.data,env=options.env||process.env;
 const scope=options.journal.prefix.split('/');if(scope.length!==5||scope[0]!=='projects'||scope[1]!==input.projectId||scope[2]!=='operations'||!z.uuid().safeParse(scope[3]).success||scope[4]!=='media-effects')throw Error('SOURCE_IMAGE_INPUT_INVALID');
 const config=dockerConfiguration({...env,VIDEO_MEDIA_IMAGE_REF:env.VIDEO_SOURCE_IMAGE_REF||env.VIDEO_MEDIA_IMAGE_REF,VIDEO_MEDIA_RUNTIME_DIGEST:env.VIDEO_SOURCE_IMAGE_RUNTIME_DIGEST||env.VIDEO_MEDIA_RUNTIME_DIGEST,VIDEO_MEDIA_TIMEOUT_SECONDS:env.VIDEO_SOURCE_IMAGE_TIMEOUT_SECONDS||'120'},'source-image');
 const producerSha256=await sourceImageProducerSha();
 // This fixed capability command exits normally for a missing producer. Missing
 // installation is a known configuration failure, not an unknown charged call.
 const capability="const fs=require('node:fs'),crypto=require('node:crypto');let sha256=null;try{sha256=crypto.createHash('sha256').update(fs.readFileSync('/opt/videobuddy/prepare-image.mjs')).digest('hex')}catch{}console.log(JSON.stringify({sha256}))";
 const actual=z.strictObject({sha256:z.string().nullable()}).parse(JSON.parse(await runOwnedDocker(['run','--rm','--network','none','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges','--pids-limit','32','--cpus','1','--memory','128m','--entrypoint','node',config.image,'-e',capability],30000,config.image,options.assertActive,options.journal)));
 if(actual.sha256!==producerSha256)throw Error('IMAGE_RUNTIME_UNAVAILABLE');await options.assertActive();
 const job:SourceImageJob=sourceImageJob({...input,schemaVersion:1,runtimeDigest:config.runtimeDigest,producerSha256,maxEdge:2048}),stageDir=join(root,'media',job.jobSha256);
 await directory(root);await mkdir(join(root,'media'),{mode:0o700}).catch(error=>{if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error});await directory(join(root,'media'));
 await mkdir(stageDir,{mode:0o700}).catch(error=>{if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error});await directory(stageDir);
 const assets=[{id:input.assetId,mime:input.sourceMime,sha256:input.sourceSha256,bytes:input.sourceBytes}];await prepareRuntimeAssets(root,input.projectId,stageDir,assets);await options.assertActive();await writeStageInputs(stageDir,'',JSON.stringify(job));await verifyRuntimeAssets(stageDir,assets);
 const args=['run','--rm','--network','none','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges','--pids-limit','128','--cpus','4','--memory','2g','--memory-swap','2g','--user',config.user,'--tmpfs','/tmp:rw,nosuid,size=256m','--mount',`type=bind,src=${stageDir},dst=/work/${job.jobSha256}`,'--mount',`type=bind,src=${stageDir}/job.json,dst=/work/${job.jobSha256}/job.json,readonly`,'--mount',`type=bind,src=${stageDir}/assets/${input.assetId}.bin,dst=/input/image.bin,readonly`,'--entrypoint','node',config.image,'/opt/videobuddy/prepare-image.mjs',`/work/${job.jobSha256}/job.json`];
 const receipt=guardSourceImageReceipt(JSON.parse(await runOwnedDocker(args,config.timeoutSeconds*1000,config.image,options.assertActive,options.journal)),job);await options.assertActive();await verifyRuntimeAssets(stageDir,assets);
 if(receipt.status==='fail')throw Error(receipt.errorCode);
 const data=await outputBytes(stageDir,receipt);await options.assertActive();return{job,receipt,path:join(stageDir,'output/view.png'),data};
}
