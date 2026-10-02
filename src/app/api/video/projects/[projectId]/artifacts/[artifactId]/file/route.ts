import{createHash}from'node:crypto';import{createReadStream}from'node:fs';import{lstat,realpath}from'node:fs/promises';import{Readable}from'node:stream';import{join}from'node:path';
import{requestOwner}from'@/services/video/access/session';
import{projectService,errorResponse}from'@/services/video/http/route-utils';
import{resolveArtifact}from'@/services/video/exports/access';
import{verifyArtifactToken}from'@/services/video/exports/local-token';
export async function GET(request:Request,{params}:{params:Promise<{projectId:string;artifactId:string}>}){try{
 const{projectId,artifactId}=await params,url=new URL(request.url),purpose=url.searchParams.get('purpose');
 if(purpose!=='play'&&purpose!=='download')throw Error('ACCESS_NOT_FOUND');
 const owner=requestOwner(request),token=url.searchParams.get('token')||'',key=process.env.VIDEO_SESSION_SIGNING_KEY;
 if(!key)throw Error('CONFIGURATION_REQUIRED');verifyArtifactToken(token,{projectId,artifactId,owner,purpose},key);
 const artifact=await resolveArtifact(projectService(),owner,projectId,artifactId),root=process.env.VIDEO_DATA_DIR;
 if(!root)throw Error('CONFIGURATION_REQUIRED');const base=join(root,'objects'),path=join(base,artifact.objectRef.key);
 const baseStat=await lstat(base),fileStat=await lstat(path),resolved=await realpath(path),baseReal=await realpath(base);
 if(baseStat.isSymbolicLink()||fileStat.isSymbolicLink()||!fileStat.isFile()||fileStat.nlink!==1||!resolved.startsWith(baseReal+'/')||fileStat.size!==artifact.objectRef.bytes)throw Error('ACCESS_NOT_FOUND');
 const hash=createHash('sha256');for await(const chunk of createReadStream(path))hash.update(chunk);if(hash.digest('hex')!==artifact.objectRef.sha256)throw Error('ACCESS_NOT_FOUND');
 let start=0,end=fileStat.size-1,status=200;const range=request.headers.get('range');
 if(range){const match=/^bytes=(\d+)-(\d*)$/.exec(range);if(!match)throw Error('VALIDATION_FAILED');start=Number(match[1]);end=match[2]?Number(match[2]):end;if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start>end||end>=fileStat.size)return new Response(null,{status:416,headers:{'Content-Range':`bytes */${fileStat.size}`,'Cache-Control':'private,no-store'}});status=206}
 const filename=artifact.filename.replace(/[\r\n\\/]/g,'_');const body=Readable.toWeb(createReadStream(path,{start,end}));
 return new Response(body as BodyInit,{status,headers:{'Content-Type':artifact.objectRef.mime,'Content-Length':String(end-start+1),'Accept-Ranges':'bytes','Cache-Control':'private,no-store','Content-Disposition':`${purpose==='play'?'inline':'attachment'}; filename*=UTF-8''${encodeURIComponent(filename)}`,...(status===206?{'Content-Range':`bytes ${start}-${end}/${fileStat.size}`}:{})}});
}catch(error){return errorResponse(error)}}
