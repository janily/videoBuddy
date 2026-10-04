import {mkdir,writeFile} from 'node:fs/promises';
import {dirname,isAbsolute,join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {styleFontBuildLock} from '../../src/services/video/media/font-catalog';
import {prepareStyleFontBuild} from './helpers/style-font-build';
async function main(){
 const args=process.argv.slice(2),download=args.includes('--download'),values=new Map<string,string>();
 for(let i=0;i<args.length;i++){if(args[i]==='--download')continue;if(!['--cache-root','--build-root'].includes(args[i])||values.has(args[i])||!args[i+1]||args[i+1].startsWith('--'))throw Error('FONT_BUILD_ARGUMENTS_INVALID');values.set(args[i],args[++i])}
 const cache=values.get('--cache-root'),build=values.get('--build-root');if(!cache||!build||!isAbsolute(cache)||!isAbsolute(build))throw Error('FONT_BUILD_ARGUMENTS_INVALID');
 if(download){
  const files:Array<{path:string;data:Buffer}>=[];
  for(const font of styleFontBuildLock().fonts)for(const source of [font.font,font.licenseFile,font.metadata]){
   const response=await fetch(source.url,{redirect:'error',signal:AbortSignal.timeout(60000)});
   if(response.status!==200||!response.body)throw Error('FONT_SOURCE_DOWNLOAD_FAILED');
   const reader=response.body.getReader(),chunks:Uint8Array[]=[];let count=0;
   try{for(;;){const part=await reader.read();if(part.done)break;count+=part.value.length;if(count>source.bytes){await reader.cancel();throw Error('STYLE_FONT_SOURCE_CHANGED')}chunks.push(part.value)}}finally{reader.releaseLock()}
   const data=Buffer.concat(chunks);if(data.length!==source.bytes||createHash('sha256').update(data).digest('hex')!==source.sha256)throw Error('STYLE_FONT_SOURCE_CHANGED');files.push({path:source.buildPath,data});
  }
  await mkdir(cache,{mode:0o700});for(const file of files){const path=join(cache,file.path);await mkdir(dirname(path),{recursive:true,mode:0o700});await writeFile(path,file.data,{flag:'wx',mode:0o600})}
 }
 const manifest=await prepareStyleFontBuild(resolve(cache),resolve(build));console.log(JSON.stringify({status:'font_build_prepared',buildRoot:build,...manifest}));
}
main().catch(error=>{console.error(String(error.message));process.exitCode=1});
