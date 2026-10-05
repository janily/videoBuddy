// Trusted offline image transport; generated scenes cannot widen this allowlist.
import {constants} from 'node:fs';
import {open,lstat,realpath} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
import {createServer} from 'node:http';
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
function catalog(raw){
 if(!Array.isArray(raw)||raw.length>10)throw Error('RUNTIME_ASSET_INVALID');
 const assets=new Map();
 for(const asset of raw){if(!asset||Object.keys(asset).sort().join(',')!=='bytes,id,mime,sha256'||!uuid.test(asset.id)||!['image/png','image/jpeg','image/webp'].includes(asset.mime)||!Number.isSafeInteger(asset.bytes)||asset.bytes<1||asset.bytes>50*1024*1024||!/^[a-f0-9]{64}$/.test(asset.sha256)||assets.has(asset.id))throw Error('RUNTIME_ASSET_INVALID');assets.set(asset.id,{...asset})}
 return assets;
}
async function read(root,asset){
 const path=join(root,'assets',asset.id+'.bin'),dir=await lstat(join(root,'assets'));if(!dir.isDirectory()||dir.isSymbolicLink()||await realpath(path)!==join(await realpath(root),'assets',asset.id+'.bin'))throw Error('RUNTIME_ASSET_CHANGED');
 const fd=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);
 try{const info=await fd.stat();if(!info.isFile()||info.nlink!==1||info.size!==asset.bytes)throw Error('RUNTIME_ASSET_CHANGED');const bytes=await fd.readFile();if(bytes.length!==asset.bytes||createHash('sha256').update(bytes).digest('hex')!==asset.sha256)throw Error('RUNTIME_ASSET_CHANGED');return bytes}finally{await fd.close()}
}
export async function verifyRuntimeAssetInputs(root,raw){for(const asset of catalog(raw).values())try{await read(root,asset)}catch{throw Error('RUNTIME_ASSET_CHANGED')}}
export function createRuntimeAssetServer(root,raw){const assets=catalog(raw);return createServer(async(req,res)=>{
 try{
  if(req.method!=='GET'&&req.method!=='HEAD')throw Error('METHOD');const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);let data,mime;
  if(pathname==='/scene.html'){
   const path=join(root,'scene.html');if(await realpath(path)!==join(await realpath(root),'scene.html'))throw Error('PATH');const fd=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);try{const info=await fd.stat();if(!info.isFile()||info.nlink!==1||info.size>2*1024*1024)throw Error('SCENE');data=await fd.readFile()}finally{await fd.close()}mime='text/html';
  }else{
   const match=/^\/assets\/([a-f0-9-]{36})\.bin$/i.exec(pathname),asset=match&&assets.get(match[1]);if(!asset)throw Error('UNDECLARED_RESOURCE');data=await read(root,asset);mime=asset.mime;
  }
  res.writeHead(200,{'Content-Type':mime,'Content-Length':data.length,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(req.method==='HEAD'?undefined:data);
 }catch{res.writeHead(404);res.end()}
})}
