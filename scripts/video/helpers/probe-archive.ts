import {lstat,mkdtemp,open,realpath} from 'node:fs/promises';
import {isAbsolute,join} from 'node:path';
/** Private diagnostics get an exclusive directory; a legacy fixed child path
 * is never followed. Durability precedes the caller's success report. */
export async function persistProbeArchive(root:string,bytes:Buffer){
 if(!isAbsolute(root))throw Error('PROBE_ARCHIVE_PATH_CHANGED');
 const info=await lstat(root);if(!info.isDirectory()||info.isSymbolicLink())throw Error('PROBE_ARCHIVE_PATH_CHANGED');
 const base=await realpath(root),directory=await mkdtemp(join(base,'clear-preview-source-'));
 if(await realpath(directory)!==directory)throw Error('PROBE_ARCHIVE_PATH_CHANGED');
 const path=join(directory,'source.zip'),file=await open(path,'wx',0o600);
 try{await file.writeFile(bytes);await file.sync()}finally{await file.close()}
 for(const parent of [directory,base]){const handle=await open(parent,'r');try{await handle.sync()}finally{await handle.close()}}
 return path;
}
