import {lstat,readdir} from 'node:fs/promises';
import {join} from 'node:path';

// Bounded, shallow inventory for initialization audits; never follow symlinks.
export async function listStateKeys(root:string,prefix:string,maxDepth:number):Promise<string[]>{
 if(!/^[A-Za-z0-9/_-]+$/.test(prefix)||prefix.split('/').some(part=>!part)||!Number.isSafeInteger(maxDepth)||maxDepth<1||maxDepth>8)throw Error('INVALID_KEY');
 const keys:string[]=[];let count=0;
 async function visit(key:string,depth:number){
  const path=join(root,key);let stat;try{stat=await lstat(path)}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return;throw error}
  if(!stat.isDirectory()||stat.isSymbolicLink())throw Error('STORE_INVENTORY_INVALID');
  for(const entry of await readdir(path,{withFileTypes:true})){
   if(++count>50000||entry.isSymbolicLink())throw Error('STORE_INVENTORY_INVALID');
   const child=key+'/'+entry.name;
   if(entry.isDirectory()&&depth<maxDepth)await visit(child,depth+1);
   else if(entry.isFile()&&entry.name.endsWith('.json')){
    const candidate=child.slice(0,-5);if(!/^[A-Za-z0-9/_-]+$/.test(candidate))throw Error('STORE_INVENTORY_INVALID');keys.push(candidate);
   }
  }
 }
 await visit(prefix,1);return keys.sort();
}
