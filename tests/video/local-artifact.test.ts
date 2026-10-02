import{it,expect,beforeEach,afterEach}from'vitest';import{mkdtemp,mkdir,writeFile,rm}from'node:fs/promises';import{tmpdir}from'node:os';import{join}from'node:path';import{createHash}from'node:crypto';
import{FileStore}from'@/services/video/storage/file-store';import{ProjectStore}from'@/services/video/storage/project-store';import{getArtifactAccess}from'@/services/video/exports/access';
let dir:string;beforeEach(async()=>{dir=await mkdtemp(join(tmpdir(),'vb-artifact-'))});afterEach(async()=>{await rm(dir,{recursive:true,force:true})});
it('a QA-approved local artifact gets a same-origin expiring URL without Blob credentials',async()=>{
 const store=new FileStore(dir),projects=new ProjectStore(store),owner='owner';const {projectId}=await projects.create(owner,{schemaVersion:5,clientCommandId:crypto.randomUUID(),clientCreateId:crypto.randomUUID()});
 const artifactId=crypto.randomUUID(),key=`projects/${projectId}/artifacts/${artifactId}/files/result.mp4`,bytes=Buffer.from('local artifact bytes');
 await mkdir(join(dir,'objects',`projects/${projectId}/artifacts/${artifactId}/files`),{recursive:true});await writeFile(join(dir,'objects',key),bytes);
 await store.create(`projects/${projectId}/artifacts/${artifactId}/manifest`,{id:artifactId,revisionId:crypto.randomUUID(),objectRef:{key,sha256:createHash('sha256').update(bytes).digest('hex'),bytes:bytes.length,mime:'video/mp4'},qaPassed:true,uploaded:true,filename:'result.mp4'});
 const old=process.env.VIDEO_SESSION_SIGNING_KEY;process.env.VIDEO_SESSION_SIGNING_KEY='s'.repeat(64);
 try{const access=await getArtifactAccess(projects,owner,projectId,artifactId,'play');expect(access.url).toMatch(new RegExp(`^/api/video/projects/${projectId}/artifacts/${artifactId}/file\\?`));expect(access.url).not.toContain('blob.vercel');}finally{if(old===undefined)delete process.env.VIDEO_SESSION_SIGNING_KEY;else process.env.VIDEO_SESSION_SIGNING_KEY=old}
});
it('artifact stream checks owner and hash, then serves a bounded byte range',async()=>{
 const{GET}=await import('@/app/api/video/projects/[projectId]/artifacts/[artifactId]/file/route');const{issueSession,ownerHash}=await import('@/services/video/access/session');
 const keys={current:'s'.repeat(64),keyId:'v1',environment:'local'},session=issueSession(keys),foreign=issueSession(keys);
 const owner=ownerHash((await import('@/services/video/access/session')).verifySession(session.token,keys).sid,keys);
 const store=new FileStore(dir),projects=new ProjectStore(store),{projectId}=await projects.create(owner,{schemaVersion:5,clientCommandId:crypto.randomUUID(),clientCreateId:crypto.randomUUID()});const artifactId=crypto.randomUUID();
 const key=`projects/${projectId}/artifacts/${artifactId}/files/result.mp4`,bytes=Buffer.from('actual bytes');await mkdir(join(dir,'objects',`projects/${projectId}/artifacts/${artifactId}/files`),{recursive:true});await writeFile(join(dir,'objects',key),bytes);
 await store.create(`projects/${projectId}/artifacts/${artifactId}/manifest`,{id:artifactId,revisionId:crypto.randomUUID(),objectRef:{key,sha256:createHash('sha256').update(bytes).digest('hex'),bytes:bytes.length,mime:'video/mp4'},qaPassed:true,uploaded:true,filename:'result.mp4'});
 const prior={VIDEO_DATA_DIR:process.env.VIDEO_DATA_DIR,VIDEO_ENVIRONMENT:process.env.VIDEO_ENVIRONMENT,VIDEO_SESSION_SIGNING_KEY:process.env.VIDEO_SESSION_SIGNING_KEY};
 Object.assign(process.env,{VIDEO_DATA_DIR:dir,VIDEO_ENVIRONMENT:'local',VIDEO_SESSION_SIGNING_KEY:keys.current});
 try{const access=await getArtifactAccess(projects,owner,projectId,artifactId,'play');const url='http://localhost:3000'+access.url;
  const read=async(token:string)=>GET(new Request(url,{headers:{cookie:`vb-session=${token}`,range:'bytes=0-5'}}),{params:Promise.resolve({projectId,artifactId})});
  const allowed=await read(session.token);expect(allowed.status).toBe(206);expect(await allowed.text()).toBe('actual');
  expect((await read(foreign.token)).status).toBe(404);
  await writeFile(join(dir,'objects',key),'tampered');expect((await read(session.token)).status).toBe(404);
 }finally{for(const [name,value]of Object.entries(prior))if(value===undefined)delete process.env[name];else process.env[name]=value}
});
