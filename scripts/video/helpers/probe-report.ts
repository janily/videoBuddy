import {open,rename} from 'node:fs/promises';
import {dirname} from 'node:path';
import {randomUUID} from 'node:crypto';

// A durable, exclusive admission is retained even when the producer crashes.
export async function claimProbeReport(path:string,initial:unknown){
 let file;
 try{file=await open(path,'wx',0o600)}catch(error){if((error as NodeJS.ErrnoException).code==='EEXIST')throw Error('PROBE_ALREADY_RECORDED_NO_AUTOMATIC_RETRY');throw error}
 try{await file.writeFile(JSON.stringify(initial,null,2)+'\n');await file.sync()}finally{await file.close()}
 const directory=await open(dirname(path),'r');try{await directory.sync()}finally{await directory.close()}
}

export async function persistProbeReport(path:string,report:unknown){
 const temporary=path+'.'+randomUUID()+'.tmp',file=await open(temporary,'wx',0o600);
 try{await file.writeFile(JSON.stringify(report,null,2)+'\n');await file.sync()}finally{await file.close()}
 await rename(temporary,path);const directory=await open(dirname(path),'r');try{await directory.sync()}finally{await directory.close()}
}
