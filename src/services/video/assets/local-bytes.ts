import {createHash,randomUUID} from 'node:crypto';
import {constants} from 'node:fs';
import {link,lstat,mkdir,open,readFile,rm} from 'node:fs/promises';
import {isAbsolute,join} from 'node:path';
import {probeMarkdown} from './probe';

function signature(bytes:Uint8Array,mime:string){
 const prefix=Buffer.from(bytes.subarray(0,32)),tail=Buffer.from(bytes.subarray(Math.max(0,bytes.length-2048)));
 if(mime==='text/markdown'){
  if(prefix.toString('ascii').startsWith('%PDF-'))throw Error('ASSET_INVALID: MIME mismatch');
  probeMarkdown(bytes);return;
 }
 const valid=mime==='image/png'?bytes.length>=24&&prefix.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))&&prefix.toString('ascii',12,16)==='IHDR':
  mime==='image/jpeg'?bytes.length>=4&&prefix[0]===255&&prefix[1]===216&&prefix[2]===255:
  mime==='image/webp'?bytes.length>=16&&prefix.toString('ascii',0,4)==='RIFF'&&prefix.toString('ascii',8,12)==='WEBP':
  mime==='application/pdf'?bytes.length>=12&&prefix.toString('ascii',0,5)==='%PDF-'&&tail.includes(Buffer.from('%%EOF')):
  false;
 if(!valid)throw Error('ASSET_INVALID: MIME mismatch');
}

export class LocalAssetBytes{
 constructor(private root:string){if(!isAbsolute(root))throw Error('CONFIGURATION_REQUIRED: VIDEO_DATA_DIR')}
 path(projectId:string,assetId:string){if(!/^[a-f0-9-]{36}$/.test(projectId)||!/^[a-f0-9-]{36}$/.test(assetId))throw Error('ASSET_INVALID');return join(this.root,'assets',projectId,assetId+'.bin')}
 async inspect(projectId:string,assetId:string,mime:string){
  const path=this.path(projectId,assetId),info=await lstat(path).catch(error=>{if((error as NodeJS.ErrnoException).code==='ENOENT')throw Error('ASSET_INVALID: upload missing');throw error});
  if(!info.isFile()||info.isSymbolicLink()||info.nlink!==1)throw Error('ASSET_INVALID');
  const bytes=await readFile(path);signature(bytes,mime);
  return{path,sha256:createHash('sha256').update(bytes).digest('hex'),bytes:bytes.length,mime};
 }
 async put(projectId:string,assetId:string,request:Request,meta:{declaredMime:string;declaredBytes:number}){
  const path=this.path(projectId,assetId),directory=join(this.root,'assets',projectId);
  if(!request.body||!Number.isSafeInteger(meta.declaredBytes)||meta.declaredBytes<1||meta.declaredBytes>50*1024*1024)throw Error('ASSET_INVALID');
  await mkdir(directory,{recursive:true,mode:0o2750});
  // Keep application state private under umask0077, while explicitly granting
  // the dedicated renderer read/search on this owned asset directory.
  const dir=await open(directory,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);try{await dir.chmod(0o2750)}finally{await dir.close()}
  const temp=join(directory,assetId+'.'+randomUUID()+'.tmp');
  const file=await open(temp,'wx',0o640);await file.chmod(0o640);const reader=request.body.getReader(),hash=createHash('sha256');let size=0;
  try{
   for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>meta.declaredBytes){await reader.cancel();throw Error('ASSET_INVALID: byte limit')}hash.update(value);await file.writeFile(value)}
   if(!size)throw Error('ASSET_INVALID');await file.sync();await file.close();
   const bytes=await readFile(temp);signature(bytes,meta.declaredMime);
   const sha256=hash.digest('hex');
   try{await link(temp,path)}catch(error){
    if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;
    const existing=await lstat(path);if(!existing.isFile()||existing.isSymbolicLink()||existing.nlink!==1||existing.size!==size||createHash('sha256').update(await readFile(path)).digest('hex')!==sha256)throw Error('ASSET_HASH_CONFLICT');
   }
   const dir=await open(directory,constants.O_RDONLY);try{await dir.sync()}finally{await dir.close()}
   return{path,sha256,bytes:size,mime:meta.declaredMime};
  }finally{await file.close().catch(()=>{});await rm(temp,{force:true})}
 }
}
