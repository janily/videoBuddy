import {createHash} from 'node:crypto';
import {constants} from 'node:fs';
import {lstat,mkdir,open,writeFile} from 'node:fs/promises';
import {isAbsolute,join,relative,dirname} from 'node:path';
import {styleFontBuildLock} from '../../../src/services/video/media/font-catalog';
import {canonicalJson,canonicalHash} from '../../../src/services/video/domain/hash';
const sha=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex');
async function readLockedFile(root:string,path:string,expected:{bytes:number;sha256:string}){
 try{
  const directory=await lstat(root),parent=await lstat(join(root,path.split('/')[0]));
  if(!directory.isDirectory()||directory.isSymbolicLink()||!parent.isDirectory()||parent.isSymbolicLink())throw Error('link');
  const handle=await open(join(root,path),constants.O_RDONLY|constants.O_NOFOLLOW);
  try{
   const stat=await handle.stat();if(!stat.isFile()||stat.nlink!==1||stat.size!==expected.bytes)throw Error('changed');
   const data=Buffer.alloc(expected.bytes+1);let total=0;
   while(total<data.length){const {bytesRead}=await handle.read(data,total,data.length-total,null);if(!bytesRead)break;total+=bytesRead}
   const actual=data.subarray(0,total);if(total!==expected.bytes||sha(actual)!==expected.sha256)throw Error('changed');return actual;
  }finally{await handle.close()}
 }catch{throw Error('STYLE_FONT_SOURCE_CHANGED')}
}
export async function prepareStyleFontBuild(cacheRoot:string,buildRoot:string){
 if(!isAbsolute(cacheRoot)||!isAbsolute(buildRoot)||relative(cacheRoot,buildRoot)===''||!relative(cacheRoot,buildRoot).startsWith('..')||!relative(buildRoot,cacheRoot).startsWith('..'))throw Error('STYLE_FONT_BUILD_PATH_INVALID');
 const lock=styleFontBuildLock(),files:Array<{path:string;data:Buffer;sha256:string}>=[];
 for(const font of lock.fonts){
  for(const [source,path] of [[font.font,'fonts/'+font.filename],[font.licenseFile,'notices/'+font.id+'/OFL.txt'],[font.metadata,'notices/'+font.id+'/METADATA.pb']] as const){
   files.push({path,data:await readLockedFile(cacheRoot,source.buildPath,source),sha256:source.sha256});
  }
 }
 try{await mkdir(buildRoot,{mode:0o700})}catch(error){if((error as NodeJS.ErrnoException).code==='EEXIST')throw Error('STYLE_FONT_BUILD_ALREADY_EXISTS');throw error}
 const checks:string[]=[];
 for(const file of files){
  const destination=join(buildRoot,file.path);await mkdir(dirname(destination),{recursive:true,mode:0o700});await writeFile(destination,file.data,{flag:'wx',mode:0o600});
  const installed=file.path.startsWith('fonts/')?'/usr/local/share/fonts/videobuddy/'+file.path.slice(6):'/usr/share/doc/videobuddy-fonts/'+file.path.slice(8);
  checks.push(file.sha256+'  '+installed);
 }
 const baseReference='videobuddy-media:font-base-'+lock.baseImage.slice(7);
 const dockerfile=`FROM ${baseReference}\nCOPY fonts/ /usr/local/share/fonts/videobuddy/\nCOPY notices/ /usr/share/doc/videobuddy-fonts/\nCOPY fonts.sha256 /opt/videobuddy/font-hashes.sha256\nRUN sha256sum -c /opt/videobuddy/font-hashes.sha256\nRUN find /usr/local/share/fonts/videobuddy /usr/share/doc/videobuddy-fonts -type d -exec chmod 0755 {} +\nRUN find /usr/local/share/fonts/videobuddy /usr/share/doc/videobuddy-fonts -type f -exec chmod 0444 {} +\nRUN fc-cache -f\nLABEL videobuddy.font-lock-sha256="${canonicalHash(lock)}"\nLABEL videobuddy.font-base-image="${lock.baseImage}"\n`;
 await writeFile(join(buildRoot,'Dockerfile'),dockerfile,{flag:'wx',mode:0o600});await writeFile(join(buildRoot,'fonts.sha256'),checks.join('\n')+'\n',{flag:'wx',mode:0o600});
 await writeFile(join(buildRoot,'.dockerignore'),'*\n!Dockerfile\n!fonts/\n!fonts/**\n!notices/\n!notices/**\n!fonts.sha256\n',{flag:'wx',mode:0o600});
 const manifest={schemaVersion:1,baseImage:lock.baseImage,baseReference,fontLockSha256:canonicalHash(lock),dockerfileSha256:sha(Buffer.from(dockerfile)),files:files.map(({path,data,sha256})=>({path,bytes:data.length,sha256}))};
 await writeFile(join(buildRoot,'build-inputs.json'),canonicalJson(manifest)+'\n',{flag:'wx',mode:0o600});return manifest;
}
