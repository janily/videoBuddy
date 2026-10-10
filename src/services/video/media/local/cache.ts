import {lstat} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {canonicalHash} from '@/services/video/domain/hash';
import type {RenderedVideo} from '../runtime';
import type {RuntimeVersion} from '../runtime-version';
import {fileIdentity,verifiedBytes} from './files';
export interface VideoManifest {schemaVersion:1;key:string;runtimeDigest:string;version:RuntimeVersion;result:RenderedVideo;inputHash:string;manifestHash:string}
export async function readVideoCache(stage:string,key:string,digest:string,inputHash:string):Promise<RenderedVideo|null>{
 let raw:string;try{raw=(await verifiedBytes(join(stage,'manifest.json'),undefined,256*1024)).toString('utf8')}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT'){const existing=await lstat(stage).catch(()=>null);if(existing)throw Error('MEDIA_CACHE_INVALID');return null;}throw error}
 const manifest=JSON.parse(raw) as VideoManifest,{manifestHash,...body}=manifest;
 if(canonicalHash(body)!==manifestHash||manifest.schemaVersion!==1||manifest.key!==key||manifest.runtimeDigest!==digest||canonicalHash(manifest.version)!==digest||manifest.inputHash!==inputHash||manifest.result?.key!==key||manifest.result.runtimeDigest!==digest||manifest.result.manifestPath!==join(stage,'manifest.json')||![join(stage,'clip.mp4'),join(stage,'final.mp4')].includes(manifest.result.outputPath)||resolve(stage)!==stage)throw Error('MEDIA_CACHE_INVALID');
 await fileIdentity(manifest.result.outputPath,manifest.result);if(manifest.result.kind==='clip'){const poster=manifest.result.poster;if(!poster||poster.path!==join(stage,'poster.png'))throw Error('MEDIA_CACHE_INVALID');await fileIdentity(poster.path,poster,20*1024*1024)}return manifest.result;
}
export function videoManifest(key:string,version:RuntimeVersion,result:RenderedVideo,inputHash:string):VideoManifest{
 const body={schemaVersion:1 as const,key,runtimeDigest:result.runtimeDigest,version,result,inputHash};return{...body,manifestHash:canonicalHash(body)};
}
