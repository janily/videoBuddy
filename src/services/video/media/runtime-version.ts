import {readFile,readdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {arch,platform,cpus} from 'node:os';
import {canonicalHash} from '@/services/video/domain/hash';
import {verifiedBytes,sha256} from './local/files';
import {encoderPolicy} from './local/arguments';
export interface RuntimeFont {id:string;family:string;filename:string;path:string;sha256:string;bytes:number;data:Buffer}
export interface RuntimeVersion {schemaVersion:1;playwright:string;chromium:string;ffmpeg:string;fonts:string;renderer:string;encoder:typeof encoderPolicy&{frameFormat:'jpeg'|'png'};platform:string;architecture:string;cpu:string;sandbox:boolean}
export async function loadRuntimeFonts(fontsDir:string){
 const lock=await readFile(join(fontsDir,'fonts.lock.json')),raw=JSON.parse(lock.toString()) as {fonts?:{id:string;family:string;filename:string;font:{buildPath:string;sha256:string;bytes:number}}[]};
 if(!Array.isArray(raw.fonts)||!raw.fonts.length)throw Error('FONT_LOCK_INVALID');const fonts:RuntimeFont[]=[];
 for(const entry of raw.fonts){if(!/^[a-z0-9-]+$/.test(entry.id)||!entry.family||!/^[-A-Za-z0-9_.]+$/.test(entry.filename)||!entry.font||!/^[a-f0-9]{64}$/.test(entry.font.sha256)||!Number.isSafeInteger(entry.font.bytes))throw Error('FONT_LOCK_INVALID');
  const path=resolve(fontsDir,entry.font.buildPath);if(!path.startsWith(resolve(fontsDir)+'/'))throw Error('FONT_LOCK_INVALID');
  const data=await verifiedBytes(path,entry.font,64*1024*1024);fonts.push({id:entry.id,family:entry.family,filename:entry.filename,path,sha256:entry.font.sha256,bytes:data.length,data});
 }
 if(new Set(fonts.map(font=>font.id)).size!==fonts.length)throw Error('FONT_LOCK_INVALID');
 return{fonts,lockHash:sha256(lock)};
}
export async function runtimeVersion(chromium:string,ffmpeg:string,fonts:string,frameFormat:'jpeg'|'png',sandbox:boolean){
 const directory=fileURLToPath(new URL('./local/',import.meta.url));
 const sourceFiles=(await readdir(directory)).filter(name=>/\.(ts|js)$/.test(name)).sort();
 const source=await Promise.all([...sourceFiles.map(name=>join(directory,name)),fileURLToPath(new URL('./runtime.ts',import.meta.url)),fileURLToPath(new URL('./runtime-assets.ts',import.meta.url)),fileURLToPath(import.meta.url)].map(path=>readFile(path)));
 const require=createRequire(import.meta.url),playwright=require('playwright/package.json').version as string;
 const version:RuntimeVersion={schemaVersion:1,playwright,chromium,ffmpeg,fonts,renderer:sha256(Buffer.concat(source)),encoder:{...encoderPolicy,frameFormat},platform:platform(),architecture:arch(),cpu:cpus()[0]?.model||'unknown',sandbox};
 return{version,runtimeDigest:canonicalHash(version)};
}
