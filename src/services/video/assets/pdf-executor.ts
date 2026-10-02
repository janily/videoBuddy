import {spawn} from 'node:child_process';
import {lstat} from 'node:fs/promises';
import {isAbsolute} from 'node:path';
import {z} from 'zod';
import {dockerConfiguration} from '@/services/video/media/docker-executor';

const extractionSchema=z.strictObject({pages:z.array(z.string()).min(1).max(100)});
export async function assertPdfRuntime(){
 const config=dockerConfiguration(process.env,'source-worker');
 const child=spawn('docker',['run','--rm','--network','none','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges','--user',config.user,'--entrypoint','test',config.image,'-f','/opt/videobuddy/analyze-pdf.mjs'],{stdio:'ignore',signal:AbortSignal.timeout(10000)});
 const code=await new Promise<number>((resolve,reject)=>{child.once('error',reject);child.once('close',code=>resolve(code??1))});
 if(code!==0)throw Error('PDF_RUNTIME_UNAVAILABLE');
}
export async function extractPdfText(path:string,assetId:string):Promise<string[]>{
 if(!isAbsolute(path)||!/^\/[A-Za-z0-9_./-]+$/.test(path))throw Error('ASSET_INVALID');
 const file=await lstat(path);if(!file.isFile()||file.isSymbolicLink()||file.nlink!==1||file.size>20*1024*1024)throw Error('ASSET_INVALID');
 const config=dockerConfiguration(process.env,`pdf-${assetId}`);
 const args=['run','--rm','--network','none','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges','--pids-limit','64','--cpus','2','--memory','512m','--memory-swap','512m','--user',config.user,'--tmpfs','/tmp:rw,nosuid,size=64m','--mount',`type=bind,src=${path},dst=/input/document.pdf,readonly`,'--entrypoint','node',config.image,'/opt/videobuddy/analyze-pdf.mjs','/input/document.pdf'];
 const child=spawn('docker',args,{stdio:['ignore','pipe','pipe'],signal:AbortSignal.timeout(60000)});
 const output:Buffer[]=[],errors:Buffer[]=[];let outputSize=0;
 child.stdout.on('data',(chunk:Buffer)=>{outputSize+=chunk.length;if(outputSize<=1024*1024)output.push(chunk);else child.kill()});
 child.stderr.on('data',(chunk:Buffer)=>{if(Buffer.concat(errors).length<8192)errors.push(chunk)});
 const code=await new Promise<number>((resolve,reject)=>{child.once('error',reject);child.once('close',code=>resolve(code??1))});
 if(code===125)throw Error('PDF_RUNTIME_UNAVAILABLE');
 if(code!==0||outputSize>1024*1024)throw Error('PDF_EXTRACTION_FAILED');
 const pages=extractionSchema.parse(JSON.parse(Buffer.concat(output).toString('utf8'))).pages;
 if(!pages.some(page=>page.trim()))throw Error('PDF_TEXT_UNAVAILABLE');
 if(Buffer.byteLength(JSON.stringify(pages))>40000)throw Error('PDF_TEXT_LIMIT');
 return pages;
}
