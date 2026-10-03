import{createHash}from 'node:crypto';
import{createReadStream}from 'node:fs';
import{lstat,realpath}from 'node:fs/promises';
import{isAbsolute,join}from 'node:path';

export async function actualArtifactSha256(root:string,relative:string,expectedBytes:number){
 if(!isAbsolute(root)||!/^projects\/[a-f0-9-]{36}\/artifacts\/[a-f0-9-]{36}\/files\/[A-Za-z0-9_-]+\.(mp4|zip)$/.test(relative))throw Error('ARTIFACT_INVALID');
 const base=join(root,'objects'),path=join(base,relative),baseReal=await realpath(base),fileReal=await realpath(path),info=await lstat(path);
 if(!fileReal.startsWith(baseReal+'/')||!info.isFile()||info.isSymbolicLink()||info.nlink!==1||info.size!==expectedBytes)throw Error('ARTIFACT_INVALID');
 const hash=createHash('sha256');for await(const chunk of createReadStream(path))hash.update(chunk);
 return hash.digest('hex');
}
