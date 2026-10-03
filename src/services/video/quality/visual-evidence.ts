import {spawn} from 'node:child_process';
import {constants} from 'node:fs';
import {createHash} from 'node:crypto';
import {mkdir,mkdtemp,open,realpath,rename,rm,lstat,writeFile} from 'node:fs/promises';
import {join,isAbsolute} from 'node:path';
import {z} from 'zod';
import {canonicalHash} from '@/services/video/domain/hash';
import {FileStore} from '@/services/video/storage/file-store';
import {createOrRead} from '@/services/video/storage/atomic-store';
const digest=z.string().regex(/^[a-f0-9]{64}$/);
const range=z.strictObject({startFrame:z.number().int().nonnegative(),endFrame:z.number().int().positive()});
const clockSchema=z.strictObject({fps:z.union([z.literal(24),z.literal(30),z.literal(60)]),totalFrames:z.number().int().positive().max(7200),shots:z.array(range.extend({id:z.string().min(1)})).min(1),actions:z.array(range).max(200)});
export function visualSamplePlan(raw:unknown,round:1|2){
 const parsed=clockSchema.safeParse(raw);if(!parsed.success||![1,2].includes(round))throw Error('VISUAL_SAMPLE_INVALID');const clock=parsed.data;
 let end=0;for(const shot of clock.shots){if(shot.startFrame!==end||shot.endFrame<=shot.startFrame||shot.endFrame>clock.totalFrames)throw Error('VISUAL_SAMPLE_INVALID');end=shot.endFrame}if(end!==clock.totalFrames)throw Error('VISUAL_SAMPLE_INVALID');
 const frames=new Set<number>([0,clock.totalFrames-1]);
 for(let n=round===1?0:clock.fps/2;n<clock.totalFrames;n+=clock.fps)frames.add(n);
 for(const shot of clock.shots){frames.add(shot.startFrame);frames.add(shot.endFrame-1)}
 for(const action of clock.actions){if(action.startFrame>=action.endFrame||action.endFrame>clock.totalFrames)throw Error('VISUAL_SAMPLE_INVALID');for(let t=action.startFrame;t<action.endFrame;t+=clock.fps/5)frames.add(Math.min(action.endFrame-1,Math.round(t)));frames.add(action.endFrame-1)}
 return[...frames].sort((a,b)=>a-b);
}
function validFrames(frames:number[]){return frames.length>0&&frames.length<=24&&frames.every((n,i)=>Number.isSafeInteger(n)&&n>=0&&n<7200&&(i===0||n>frames[i-1]))}
export function frameExtractionArguments(filmPath:string,outputDir:string,image:string,frames:number[]){
 if(![filmPath,outputDir].every(path=>isAbsolute(path)&&/^\/[A-Za-z0-9_./-]+$/.test(path)&&!path.split('/').includes('..'))||!/^sha256:[a-f0-9]{64}$/.test(image)||!validFrames(frames))throw Error('VISUAL_SAMPLE_INVALID');
 return['run','--rm','--network','none','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges','--pids-limit','64','--cpus','2','--memory','1g','--user',`${process.getuid?.()??10001}:${process.getgid?.()??10001}`,'--tmpfs','/tmp:rw,nosuid,size=32m','--mount',`type=bind,src=${filmPath},dst=/input/film.mp4,readonly`,'--mount',`type=bind,src=${outputDir},dst=/output`,image,'ffmpeg','-nostdin','-v','error','-xerror','-threads','2','-filter_threads','2','-i','/input/film.mp4','-map','0:v:0','-vf','select='+frames.map(n=>`eq(n\\,${n})`).join('+'),'-fps_mode','passthrough','-frames:v',String(frames.length),'-c:v','png','-f','image2','/output/frame-%04d.png'];
}
const filmSchema=z.strictObject({outputPath:z.string(),sha256:digest,width:z.number().int().min(64).max(3840),height:z.number().int().min(64).max(3840),totalFrames:z.number().int().positive().max(7200)});
const frameSchema=z.strictObject({id:z.string(),frame:z.number().int().nonnegative(),sha256:digest,bytes:z.number().int().positive().max(8*1024*1024),filename:z.string().regex(/^frame-\d{4}\.png$/)});
export const VisualEvidenceSchema=z.strictObject({schemaVersion:z.literal(2),extractor:z.literal('ffmpeg-select-v2'),stageKey:digest,filmSha256:digest,runtimeDigest:digest,width:z.number().int(),height:z.number().int(),frames:z.array(frameSchema).min(1).max(24)});
export type VisualEvidence=z.infer<typeof VisualEvidenceSchema>;
async function fileHash(path:string){
 const file=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);
 try{const stat=await file.stat();if(!stat.isFile()||stat.nlink!==1)throw Error('VISUAL_EVIDENCE_CHANGED');const hash=createHash('sha256');for await(const chunk of file.createReadStream({autoClose:false}))hash.update(chunk);return hash.digest('hex')}finally{await file.close()}
}
async function pngBytes(path:string,width:number,height:number){
 const handle=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);
 try{const stat=await handle.stat();if(!stat.isFile()||stat.nlink!==1||stat.size<33||stat.size>8*1024*1024)throw Error('VISUAL_EVIDENCE_CHANGED');const bytes=await handle.readFile();if(bytes.subarray(0,8).toString('hex')!=='89504e470d0a1a0a'||bytes.toString('ascii',12,16)!=='IHDR'||bytes.readUInt32BE(16)!==width||bytes.readUInt32BE(20)!==height)throw Error('VISUAL_EVIDENCE_CHANGED');return bytes}finally{await handle.close()}
}
async function readManifest(path:string){
 const file=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);
 try{const stat=await file.stat();if(!stat.isFile()||stat.nlink!==1||stat.size>256*1024)throw Error('VISUAL_EVIDENCE_CHANGED');return VisualEvidenceSchema.parse(JSON.parse(await file.readFile('utf8')))}finally{await file.close()}
}
export async function readVisualEvidence(root:string,expected:VisualEvidence){
 if(!isAbsolute(root))throw Error('VISUAL_EVIDENCE_CHANGED');
 const evidence=VisualEvidenceSchema.parse(expected),rootReal=await realpath(root),directory=join(rootReal,'visual-evidence',evidence.stageKey);
 const frameNumbers=evidence.frames.map(f=>f.frame);
 if(!validFrames(frameNumbers)||evidence.stageKey!==canonicalHash({extractor:'ffmpeg-select-v2',filmSha256:evidence.filmSha256,runtimeDigest:evidence.runtimeDigest,width:evidence.width,height:evidence.height,frames:frameNumbers})||evidence.frames.some((f,i)=>f.id!=='frame-'+f.frame||f.filename!=='frame-'+String(i+1).padStart(4,'0')+'.png'))throw Error('VISUAL_EVIDENCE_CHANGED');
 const receiptDir=join(rootReal,'visual-frame-runs');let receipt:VisualEvidence;
 try{if(await realpath(receiptDir)!==receiptDir)throw Error('VISUAL_EVIDENCE_CHANGED');receipt=await readManifest(join(receiptDir,evidence.stageKey+'.json'))}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')throw Error('VISUAL_EVIDENCE_RECEIPT_MISSING');throw error}
 if(canonicalHash(receipt)!==canonicalHash(evidence))throw Error('VISUAL_EVIDENCE_CHANGED');
 if(await realpath(directory)!==directory)throw Error('VISUAL_EVIDENCE_CHANGED');
 const manifest=await readManifest(join(directory,'manifest.json'));
 if(canonicalHash(manifest)!==canonicalHash(evidence))throw Error('VISUAL_EVIDENCE_CHANGED');
 const images=new Map<string,Uint8Array>();for(const frame of evidence.frames){const data=await pngBytes(join(directory,frame.filename),evidence.width,evidence.height);if(data.length!==frame.bytes||createHash('sha256').update(data).digest('hex')!==frame.sha256)throw Error('VISUAL_EVIDENCE_CHANGED');images.set(frame.id,data)}return images;
}
export async function extractVisualFrames(root:string,rawFilm:z.input<typeof filmSchema>,frames:number[],image:string):Promise<VisualEvidence>{
 const parsed=filmSchema.safeParse(rawFilm);if(!parsed.success||!validFrames(frames)||frames.at(-1)!>=parsed.data.totalFrames||!isAbsolute(root)||!/^sha256:[a-f0-9]{64}$/.test(image))throw Error('VISUAL_SAMPLE_INVALID');const film=parsed.data;
 const rootReal=await realpath(root),fileReal=await realpath(film.outputPath);
 if(!fileReal.startsWith(rootReal+'/composition/')||fileReal!==film.outputPath||await fileHash(fileReal)!==film.sha256)throw Error('VISUAL_FILM_CHANGED');
 const runtimeDigest=image.slice(7),stageKey=canonicalHash({extractor:'ffmpeg-select-v2',filmSha256:film.sha256,runtimeDigest,width:film.width,height:film.height,frames}),parent=join(rootReal,'visual-evidence'),destination=join(parent,stageKey);
 await mkdir(parent,{recursive:true,mode:0o700});
 if(await realpath(parent)!==parent)throw Error('VISUAL_EVIDENCE_CHANGED');
 try{const existing=await readManifest(join(destination,'manifest.json'));if(existing.stageKey!==stageKey||existing.filmSha256!==film.sha256||existing.runtimeDigest!==runtimeDigest||existing.width!==film.width||existing.height!==film.height||canonicalHash(existing.frames.map(f=>f.frame))!==canonicalHash(frames))throw Error('VISUAL_EVIDENCE_CHANGED');await readVisualEvidence(rootReal,existing);return existing}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;if(await lstat(destination).catch(()=>null))throw Error('VISUAL_EVIDENCE_UNKNOWN')}
 const temp=await mkdtemp(join(parent,'extract-'));
 try{
  const args=frameExtractionArguments(fileReal,temp,image,frames),child=spawn('docker',args,{stdio:['ignore','ignore','ignore'],signal:AbortSignal.timeout(120000)});
  const code=await new Promise<number>((resolve,reject)=>{child.once('error',reject);child.once('close',value=>resolve(value??1))});if(code!==0)throw Error('VISUAL_EXTRACTION_FAILED');
  const records:VisualEvidence['frames']=[];for(const [index,frame] of frames.entries()){const filename='frame-'+String(index+1).padStart(4,'0')+'.png',path=join(temp,filename),data=await pngBytes(path,film.width,film.height);records.push({id:'frame-'+frame,frame,sha256:createHash('sha256').update(data).digest('hex'),bytes:data.length,filename});const file=await open(path,'r');try{await file.sync()}finally{await file.close()}}
  if(await fileHash(fileReal)!==film.sha256)throw Error('VISUAL_FILM_CHANGED');
  const evidence:VisualEvidence={schemaVersion:2,extractor:'ffmpeg-select-v2',stageKey,filmSha256:film.sha256,runtimeDigest,width:film.width,height:film.height,frames:records};
  await writeFile(join(temp,'manifest.json'),JSON.stringify(evidence),{flag:'wx',mode:0o600});const marker=await open(join(temp,'manifest.json'),'r');try{await marker.sync()}finally{await marker.close()}
  const dir=await open(temp,'r');try{await dir.sync()}finally{await dir.close()}
  const receipt=await createOrRead(new FileStore(rootReal),'visual-frame-runs/'+stageKey,evidence);if(canonicalHash(receipt)!==canonicalHash(evidence))throw Error('VISUAL_EVIDENCE_CHANGED');
  try{await rename(temp,destination)}catch(error){if(!['EEXIST','ENOTEMPTY'].includes((error as NodeJS.ErrnoException).code||''))throw error}
  const parentHandle=await open(parent,'r');try{await parentHandle.sync()}finally{await parentHandle.close()}
  await readVisualEvidence(rootReal,evidence);return evidence;
 }finally{await rm(temp,{recursive:true,force:true})}
}
