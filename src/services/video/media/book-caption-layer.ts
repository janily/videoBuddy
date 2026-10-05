import {createHash} from 'node:crypto';
import {constants} from 'node:fs';
import {mkdir,open,readFile,lstat,readdir} from 'node:fs/promises';
import {isAbsolute,join,resolve} from 'node:path';
import {z} from 'zod';
import type {CaptionStyle,CompositionSpec} from './compose';
import type {SubtitleCue} from '../audio/subtitles';
import type {Environment} from '../config/environment';
import type {DockerJournal} from './docker-journal';
import {assertDockerCacheReusable,readDockerInvocation,dockerArgumentsHash} from './docker-journal';
import {dockerConfiguration} from './docker-executor';
import {runOwnedDocker} from './owned-docker';
import {trustedStyleFont} from './font-catalog';
import {readPinnedStyleFont} from '../audio/style-font';
import {canonicalHash,canonicalJson} from '../domain/hash';
export const bookCaptionProducerSha256='826eacf6f5b7627557f85e6bb18f745eca74c13c8fedcd64b4157c0cc850d157';
export const bookCaptionRendererSha256='74d0e41f99a34f7b2da803427d4ba0a5144237e5a96c798adb1cce377a0a167a';
export const clearBookCaptionRendererSha256='f05641cb89861f8a931025b09637470dfe569ce0bacd0e9c6a8f391ebbf87591';
const boxSchema=z.strictObject({x:z.number().int().nonnegative(),y:z.number().int().nonnegative(),width:z.number().int().min(110),height:z.number().int().min(126)});
export interface BookCaptionDescriptor{schemaVersion:1|2;rendererSha256:string;producerSha256:string;fonts:{id:string;sha256:string}[];safeBox:z.infer<typeof boxSchema>}
export function bookCaptionStyle(output:{width:number;height:number},safeBox:BookCaptionDescriptor['safeBox'],version:1|2=1):CaptionStyle{
 const style:CaptionStyle={fontSize:52,marginV:0,outline:0,primary:'#563c2e',outlineColor:'#563c2e',playResX:output.width,playResY:output.height,book:{schemaVersion:version,rendererSha256:version===2?clearBookCaptionRendererSha256:bookCaptionRendererSha256,producerSha256:bookCaptionProducerSha256,fonts:(version===2?['longcang','patrickhand']:['mashanzheng','patrickhand']).map(id=>({id,sha256:trustedStyleFont(id).font.sha256})),safeBox}};
 validateBookCaptionStyle(style);return style;
}
export function validateBookCaptionStyle(style:CaptionStyle){
 const book=style.book,box=boxSchema.safeParse(book?.safeBox),clear=book?.schemaVersion===2;
 if(!book||![1,2].includes(book.schemaVersion)||book.rendererSha256!==(clear?clearBookCaptionRendererSha256:bookCaptionRendererSha256)||book.producerSha256!==bookCaptionProducerSha256||!box.success||style.fontSize!==52||style.marginV!==0||style.outline!==0||style.primary!=='#563c2e'||style.outlineColor!=='#563c2e'||![[1920,1080],[1080,1920]].some(([w,h])=>style.playResX===w&&style.playResY===h)||box.data.x+box.data.width>style.playResX!||box.data.y+box.data.height>style.playResY!||canonicalHash(book.fonts)!==canonicalHash((clear?['longcang','patrickhand']:['mashanzheng','patrickhand']).map(id=>({id,sha256:trustedStyleFont(id).font.sha256}))))throw Error('CAPTION_STYLE_INVALID');
}
const digest=(b:Buffer)=>createHash('sha256').update(b).digest('hex');
const receiptSchema=z.strictObject({schemaVersion:z.literal(1),jobSha256:z.string().regex(/^[a-f0-9]{64}$/),rendererSha256:z.enum([bookCaptionRendererSha256,clearBookCaptionRendererSha256]),outputSha256:z.string().regex(/^[a-f0-9]{64}$/),outputBytes:z.number().int().positive(),frames:z.number().int().positive(),width:z.number().int().positive(),height:z.number().int().positive(),fps:z.number().int().positive()});
async function writeOnce(path:string,bytes:Buffer,mustExist:boolean){
 if(!mustExist){try{const file=await open(path,'wx',0o600);try{await file.writeFile(bytes);await file.sync()}finally{await file.close()}return}catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error}}
 const file=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);try{const stat=await file.stat();if(!stat.isFile()||stat.nlink!==1||stat.size!==bytes.length||!(await file.readFile()).equals(bytes))throw Error('BOOK_CAPTION_INPUT_CHANGED')}finally{await file.close()}
}
export async function prepareBookCaptionLayer(root:string,cues:SubtitleCue[],style:CaptionStyle,spec:CompositionSpec,env:Environment,options:{mustExist?:boolean;journal?:DockerJournal;assertActive?:()=>Promise<void>}={}){
 validateBookCaptionStyle(style);
 if(!/^[a-f0-9]{64}$/.test(spec.bundleHash)||!Number.isSafeInteger(spec.fence)||spec.fence<0||!isAbsolute(root)||!cues.length||![24,30,60].includes(spec.fps)||!Number.isSafeInteger(spec.durationSec)||spec.durationSec<20||spec.durationSec>120||![spec.width,spec.height].every(v=>Number.isInteger(v)&&v>=64&&v<=3840&&v%2===0)||Math.abs(spec.width/spec.height-style.playResX!/style.playResY!)>0.0001)throw Error('BOOK_CAPTION_JOB_INVALID');
 let end=0;
 for(const cue of cues){if(!cue.lineId||typeof cue.text!=='string'||!cue.text.trim()||cue.text.length>500||!Number.isSafeInteger(cue.startMs)||cue.startMs<end||!Number.isSafeInteger(cue.endMs)||cue.endMs<=cue.startMs+350||cue.endMs>spec.durationSec*1000)throw Error('BOOK_CAPTION_JOB_INVALID');const chars=[...cue.text].filter(char=>!/^\s$/.test(char)).length,reading=Math.ceil((chars/(/\p{Script=Han}/u.test(cue.text)?4.5:15)+1.5)*1000);if(cue.endMs-cue.startMs-350<Math.max(1800,reading))throw Error('BOOK_CAPTION_READING_CONFLICT');end=cue.endMs}
 if(!options.journal)throw Error('BOOK_CAPTION_JOURNAL_REQUIRED');
 const config=dockerConfiguration(env,'book-caption'),rendererHash=style.book!.rendererSha256,source=await readFile(resolve(style.book!.schemaVersion===2?'runtime/media/book-caption-clear.mjs':'runtime/media/book-caption.mjs')),runner=await readFile(resolve('runtime/media/book-caption-producer.mjs'));
 if(digest(source)!==rendererHash||digest(runner)!==bookCaptionProducerSha256)throw Error('BOOK_CAPTION_RENDERER_CHANGED');
 const fonts=[];
 for(const id of style.book!.fonts.map(f=>f.id)){
  const actual=await readPinnedStyleFont(env,id,{journal:options.journal,assertActive:options.assertActive}),font=trustedStyleFont(id);
  for(const cue of cues.filter(c=>(/\p{Script=Han}/u.test(c.text)?style.book!.fonts[0].id:'patrickhand')===id))for(const char of cue.text)if(!/^\s$/.test(char)&&!actual.glyphs.has(char))throw Error('FONT_GLYPH_MISSING');
  fonts.push({id,family:font.family,path:font.runtimePath,sha256:font.font.sha256});
 }
 const job={schemaVersion:1,bundleHash:spec.bundleHash,fence:spec.fence,runtimeDigest:config.runtimeDigest,rendererSha256:rendererHash,producerSha256:digest(runner),fonts,logicalWidth:style.playResX,logicalHeight:style.playResY,width:spec.width,height:spec.height,fps:spec.fps,frames:spec.durationSec*spec.fps,safeBox:style.book!.safeBox,cues:cues.map(c=>({id:c.lineId,text:c.text,startMs:c.startMs,endMs:c.endMs}))},key=canonicalHash(job),stageDir=join(root,'caption-layer',key),outputDir=join(stageDir,'output');
 if(!options.mustExist)await mkdir(outputDir,{recursive:true,mode:0o700});
 for(const path of [stageDir,outputDir]){const stat=await lstat(path);if(!stat.isDirectory()||stat.isSymbolicLink())throw Error('BOOK_CAPTION_STAGE_UNKNOWN')}
 await writeOnce(join(stageDir,'renderer.mjs'),source,Boolean(options.mustExist));await writeOnce(join(stageDir,'producer.mjs'),runner,Boolean(options.mustExist));await writeOnce(join(stageDir,'job.json'),Buffer.from(canonicalJson(job)),Boolean(options.mustExist));
 const args=['run','--rm','--network','none','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges','--pids-limit','256','--cpus','4','--memory','2g','--memory-swap','2g','--user',config.user,'--tmpfs','/tmp:rw,nosuid,size=512m','--mount',`type=bind,src=${stageDir},dst=/work,readonly`,'--mount',`type=bind,src=${outputDir},dst=/output`,config.image,'node','/work/producer.mjs',key];
 const outputPath=join(outputDir,'captions.mov'),receiptPath=join(outputDir,'receipt.json');let exists=false;try{const stat=await lstat(receiptPath);if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||stat.size>4096)throw Error('BOOK_CAPTION_RECEIPT_INVALID');exists=true}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error}
 if(!exists&&(await readdir(outputDir)).length)throw Error('BOOK_CAPTION_STAGE_UNKNOWN');
 if(!exists&&options.mustExist)throw Error('BOOK_CAPTION_STAGE_MISSING');
 await options.assertActive?.();
 if(exists){const cached=await assertDockerCacheReusable(options.journal,args,config.image);if(!cached)throw Error('BOOK_CAPTION_PRODUCER_UNKNOWN')}
 if(!exists)await runOwnedDocker(args,Math.max(60000,config.timeoutSeconds*1000),config.image,options.assertActive,options.journal);
 const file=await open(receiptPath,constants.O_RDONLY|constants.O_NOFOLLOW);let receipt;
 try{const stat=await file.stat();if(!stat.isFile()||stat.nlink!==1||stat.size>4096)throw Error('BOOK_CAPTION_RECEIPT_INVALID');const buffer=Buffer.alloc(4097),{bytesRead}=await file.read(buffer,0,buffer.length,0);if(bytesRead!==stat.size||bytesRead>4096)throw Error('BOOK_CAPTION_RECEIPT_INVALID');receipt=receiptSchema.parse(JSON.parse(buffer.subarray(0,bytesRead).toString('utf8')))}finally{await file.close()}
 const completed=await readDockerInvocation(options.journal,dockerArgumentsHash(args,config.image),config.image);
 if(completed.state!=='completed'||!completed.output)throw Error('BOOK_CAPTION_PRODUCER_UNKNOWN');
 let nativeReceipt;try{nativeReceipt=receiptSchema.parse(JSON.parse(completed.output))}catch{throw Error('BOOK_CAPTION_RECEIPT_INVALID')}
 if(canonicalHash(nativeReceipt)!==canonicalHash(receipt))throw Error('BOOK_CAPTION_RECEIPT_CHANGED');
 const output=await open(outputPath,constants.O_RDONLY|constants.O_NOFOLLOW);let outputSha256;
 try{const stat=await output.stat();if(!stat.isFile()||stat.nlink!==1||stat.size!==receipt.outputBytes||stat.size>512*1024*1024)throw Error('BOOK_CAPTION_OUTPUT_CHANGED');const hash=createHash('sha256');for await(const part of output.createReadStream({autoClose:false,start:0,end:stat.size-1}))hash.update(part);outputSha256=hash.digest('hex')}finally{await output.close()}
 if(receipt.rendererSha256!==rendererHash||receipt.jobSha256!==key||receipt.outputSha256!==outputSha256||receipt.frames!==job.frames||receipt.width!==spec.width||receipt.height!==spec.height||receipt.fps!==spec.fps)throw Error('BOOK_CAPTION_OUTPUT_CHANGED');
 await options.assertActive?.();return{stageKey:key,outputPath,sha256:outputSha256,bytes:receipt.outputBytes,frames:receipt.frames};
}
