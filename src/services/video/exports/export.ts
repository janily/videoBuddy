import {validateOutputPath,OutputFile}from '@/services/video/media/executor';
export function validateArchiveEntries(entries:(OutputFile&{bytes:number})[],allowlist:string[]){let bytes=0;return entries.map(file=>{
 if(!allowlist.includes(file.path)||file.symlink||file.hardlinks!==1||/\.(ttf|otf|woff2?|onnx|safetensors|bin)$/i.test(file.path)||/(^|\/)(\.env[^/]*|cache|tmp|node_modules)(\/|$)/.test(file.path)||file.path.split('/').includes('..')||file.path.startsWith('/')||/[\u0000-\u001f]/.test(file.path)||!Number.isSafeInteger(file.bytes)||file.bytes<0)throw Error('ARCHIVE_INVALID');
 bytes+=file.bytes;if(bytes>150*1024*1024)throw Error('ARCHIVE_INVALID');return file.path;
})}
export function assertArtifactAccess(control:{deletedAt?:string;expiresAt?:string},artifact:{qaPassed:boolean;uploaded:boolean;mime:string}){if(control.deletedAt)throw Error('ACCESS_NOT_FOUND');if(control.expiresAt&&Date.parse(control.expiresAt)<=Date.now())throw Error('PROJECT_EXPIRED');if(!artifact.uploaded||!artifact.qaPassed)throw Error('QUALITY_BLOCKED');if(!['video/mp4','image/png','text/plain','application/json','application/zip'].includes(artifact.mime))throw Error('ARTIFACT_INVALID')}
void validateOutputPath;
