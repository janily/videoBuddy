import {isAbsolute,join} from 'node:path';
import {mkdir} from 'node:fs/promises';
import {createLocalRuntime} from '../../src/services/video/media/local';
import {startRenderServer} from '../../src/services/video/media/render-server';

/** This entry point is run as videobuddy-render, with an empty inherited env. */
async function main(){
 const allowed=new Set(['PATH','HOME','LANG','LC_ALL','NODE_ENV','VIDEO_DATA_DIR','VIDEO_RENDER_SOCKET','VIDEO_MUSIC_DIR','PLAYWRIGHT_BROWSERS_PATH','VIDEO_FFMPEG_PATH','VIDEO_FFPROBE_PATH','VIDEO_UNSAFE_NO_SANDBOX','VIDEO_CHROMIUM_EXECUTABLE_PATH']);
 if(process.env.NODE_ENV==='production'){
  if(process.getuid?.()===0)throw Error('SANDBOX_UNAVAILABLE');
  for(const key of Object.keys(process.env))if(!allowed.has(key))throw Error('RENDER_ENVIRONMENT_INVALID');
 }
 const root=process.env.VIDEO_DATA_DIR,socket=process.env.VIDEO_RENDER_SOCKET;
 if(!root||!isAbsolute(root)||!socket||!isAbsolute(socket)||socket!==join(root,'media','render.sock'))throw Error('RENDER_CONFIGURATION_INVALID');
 await mkdir(join(root,'media'),{recursive:true,mode:0o2770});
 const runtime=await createLocalRuntime({root});
 try{
  const server=await startRenderServer(runtime,socket);let stopped=false;
  const stop=async()=>{if(stopped)return;stopped=true;await server.close();await runtime.close()};
  process.once('SIGTERM',()=>void stop().catch(()=>{process.exitCode=1}));
  process.once('SIGINT',()=>void stop().catch(()=>{process.exitCode=1}));
  console.log(JSON.stringify({event:'render_ready',runtimeDigest:runtime.runtimeDigest,sandbox:runtime.version.sandbox}));
 }catch(error){await runtime.close();throw error}
}
main().catch(error=>{console.error(error instanceof Error?error.message.split(':')[0]:'RENDER_FAILED');process.exitCode=1});
