import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {runOwnedDocker} from './owned-docker';
import type {DockerJournal} from './docker-journal';
export async function runtimeAssetRendererHashes(){const files=['render.mjs','runtime-assets.mjs'] as const;return Object.fromEntries(await Promise.all(files.map(async file=>[file,createHash('sha256').update(await readFile(join(process.cwd(),'runtime/media',file))).digest('hex')])))}
export function validateRuntimeAssetRenderer(output:string,expected:Record<string,string>){
 const lines=output.trim().split('\n');if(lines.length!==2||new Set(lines).size!==2)throw Error('RUNTIME_ASSET_RENDERER_UNAVAILABLE');
 for(const file of ['render.mjs','runtime-assets.mjs'])if(!/^[a-f0-9]{64}$/.test(expected[file]||'')||!lines.includes(expected[file]+'  /opt/videobuddy/'+file))throw Error('RUNTIME_ASSET_RENDERER_UNAVAILABLE');
}
export async function assertRuntimeAssetRenderer(image:string,options:{assertActive?:()=>Promise<void>;journal?:DockerJournal}={}){
 const hashes=await runtimeAssetRendererHashes();
 const output=await runOwnedDocker(['run','--rm','--network','none','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges','--pids-limit','32','--cpus','1','--memory','128m',image,'sha256sum','/opt/videobuddy/render.mjs','/opt/videobuddy/runtime-assets.mjs'],30000,image,options.assertActive,options.journal);
 validateRuntimeAssetRenderer(output,hashes);await options.assertActive?.();return hashes;
}
