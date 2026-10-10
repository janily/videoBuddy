import {spawn} from 'node:child_process';
import {sanitizedEnvironment} from './environment';
export interface ProcessOptions {signal?:AbortSignal;timeoutMs?:number;stdin?:AsyncIterable<Uint8Array>;maxOutputBytes?:number;env?:Record<string,string|undefined>}
export function assertNotAborted(signal?:AbortSignal){if(signal?.aborted)throw Error('MEDIA_ABORTED')}
/** Never inherits credentials, shell settings, proxies or NODE_OPTIONS. */
export async function runProcess(executable:string,args:string[],options:ProcessOptions={}){
 assertNotAborted(options.signal);
 const child=spawn(executable,args,{stdio:['pipe','pipe','pipe'],env:sanitizedEnvironment(options.env),detached:process.platform!=='win32'});
 let failure:Error|undefined,stdoutBytes=0,stderrBytes=0;const stdout:Buffer[]=[],stderr:Buffer[]=[];
 const kill=()=>{if(!child.pid)return;try{if(process.platform!=='win32')process.kill(-child.pid,'SIGKILL');else child.kill('SIGKILL')}catch{child.kill('SIGKILL')}};
 const fail=(error:Error)=>{failure??=error;kill()};
 const onAbort=()=>fail(Error('MEDIA_ABORTED'));options.signal?.addEventListener('abort',onAbort,{once:true});
 const timer=setTimeout(()=>fail(Error('MEDIA_PROCESS_TIMEOUT')),options.timeoutMs??120000);
 const max=options.maxOutputBytes??1024*1024;
 child.stdout.on('data',(chunk:Buffer)=>{stdoutBytes+=chunk.length;if(stdoutBytes>max)fail(Error('MEDIA_OUTPUT_LIMIT'));else stdout.push(chunk)});
 child.stderr.on('data',(chunk:Buffer)=>{if(stderrBytes<16384){stderr.push(chunk.subarray(0,16384-stderrBytes));stderrBytes+=chunk.length}});
 // stdin errors are observed even while an async frame producer is waiting.
 child.stdin.on('error',(error:Error)=>{failure??=error});
 const exit=new Promise<void>((resolve,reject)=>{
  child.once('error',error=>{failure??=error});
  child.once('close',code=>{if(failure)reject(failure);else if(code!==0)reject(Error(`MEDIA_PROCESS_FAILED: ${Buffer.concat(stderr).toString().slice(0,1000)}`));else resolve()});
 });
 void exit.catch(()=>{});
 const write=async()=>{
  if(options.stdin)for await(const chunk of options.stdin){assertNotAborted(options.signal);if(failure)throw failure;if(!child.stdin.write(chunk))await new Promise<void>((resolve,reject)=>{
   const cleanup=()=>{child.stdin.off('drain',drain);child.stdin.off('error',error);child.stdin.off('close',close)};
   const drain=()=>{cleanup();resolve()},error=(e:Error)=>{cleanup();reject(e)},close=()=>error(failure||Error('MEDIA_PIPE_CLOSED'));
   child.stdin.once('drain',drain);child.stdin.once('error',error);child.stdin.once('close',close);
  })}
  child.stdin.end();
 };
 const producer=write().catch(error=>{fail(error instanceof Error?error:Error('MEDIA_INPUT_FAILED'));throw error});void producer.catch(()=>{});
 try{await Promise.race([producer,exit]);await exit;return{stdout:Buffer.concat(stdout).toString('utf8'),stderr:Buffer.concat(stderr).toString('utf8')}}
 finally{clearTimeout(timer);options.signal?.removeEventListener('abort',onAbort);if(child.exitCode===null)kill();await exit.catch(()=>{})}
}
export function mediaBinaries(env:Record<string,string|undefined>=process.env){return{ffmpeg:env.VIDEO_FFMPEG_PATH||'ffmpeg',ffprobe:env.VIDEO_FFPROBE_PATH||'ffprobe'}}
