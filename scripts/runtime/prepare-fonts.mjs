import {readFile,writeFile,rename,unlink} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
// Git transport limits require the large CJK font to be stored in two parts.
// Reassemble the exact pinned upstream bytes before installing a read-only release.
const root=fileURLToPath(new URL('../../runtime/fonts/',import.meta.url));
const lock=JSON.parse(await readFile(join(root,'fonts.lock.json'),'utf8'));
for(const font of lock.fonts){
 if(!font.font.parts)continue;
 const data=Buffer.concat(await Promise.all(font.font.parts.map(part=>readFile(join(root,part)))));
 if(data.length!==font.font.bytes||createHash('sha256').update(data).digest('hex')!==font.font.sha256)throw Error('FONT_PARTS_INVALID');
 const target=join(root,font.font.buildPath);
 try{const existing=await readFile(target);if(existing.equals(data))continue}catch(error){if(error.code!=='ENOENT')throw error}
 const temp=target+'.'+randomUUID()+'.tmp';
 try{await writeFile(temp,data,{flag:'wx',mode:0o644});await rename(temp,target)}finally{await unlink(temp).catch(error=>{if(error.code!=='ENOENT')throw error})}
}
