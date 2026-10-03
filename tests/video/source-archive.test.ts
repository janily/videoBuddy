import {expect,it} from 'vitest';
import {spawnSync} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {createHash} from 'node:crypto';
import {encodeSourceArchive} from '@/services/video/exports/source-zip';
import {prepareFrozenSourceArchive} from '@/services/video/exports/source-archive';
import {ProjectStore} from '@/services/video/storage/project-store';
import {FileStore} from '@/services/video/storage/file-store';
import {seedPreviewBundle} from './fixtures/preview-package';

function unpack(bytes:Buffer){
 const result=spawnSync('python3',['-c',"import sys,io,zipfile,json,hashlib; z=zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read())); assert z.testzip() is None; print(json.dumps({n:hashlib.sha256(z.read(n)).hexdigest() for n in z.namelist()}))"],{input:bytes});
 expect(result.status,result.stderr.toString()).toBe(0);return JSON.parse(result.stdout.toString()) as Record<string,string>;
}
it('T14 creates deterministic ZIP bytes independently readable with correct CRC and content hashes',()=>{
 const entries=[{path:'source/你好.html',bytes:Buffer.from('<p>青禾</p>')},{path:'timeline.json',bytes:Buffer.from('{}')}];
 const zip=encodeSourceArchive(entries),files=unpack(zip);
 expect(files['source/你好.html']).toBe(createHash('sha256').update(entries[0].bytes).digest('hex'));
 expect(encodeSourceArchive([...entries].reverse()).equals(zip)).toBe(true);
});
it.each(['../secret','/absolute','a\\b.json','source/.env','runtime/font.woff2','runtime/model.onnx','node_modules/a.js','a//b.json','a/./b.json','a/CON.json','a/NUL','a/trailing.','a/trailing '])('T14 refuses unsafe archive path %s',(path)=>{
 expect(()=>encodeSourceArchive([{path,bytes:Buffer.from('x')}])).toThrow('ARCHIVE_INVALID');
});
it('T14 rejects duplicate entries, credentials, signed URLs and excessive files',()=>{
 expect(()=>encodeSourceArchive([{path:'x.json',bytes:Buffer.from('{}')},{path:'x.json',bytes:Buffer.from('{}')}])).toThrow('ARCHIVE_INVALID');
 for(const body of ['{"apiKey":"private"}','{"api\\u004bey":"private"}','client_secret=oauth-secret-value-for-review','{"private_key":"private"}','-----BEGIN RSA PRIVATE KEY-----','Authorization: Bearer secret','https://host/a?token=secret','https://host/a?%74oken=secret','sk-'+ 'a'.repeat(32)])expect(()=>encodeSourceArchive([{path:'x.json',bytes:Buffer.from(body)}])).toThrow('ARCHIVE_PRIVATE_DATA');
 expect(()=>encodeSourceArchive(Array.from({length:2049},(_,i)=>({path:i+'.json',bytes:Buffer.from('{}')})))).toThrow('ARCHIVE_INVALID');
});
it('T14 rejects case-insensitive collisions, file/directory collisions and final ZIP size over the limit',()=>{
 for(const paths of [['Source/a.html','source/A.html'],['a','a/b.json']])expect(()=>encodeSourceArchive(paths.map(path=>({path,bytes:Buffer.from('x')})))).toThrow('ARCHIVE_INVALID');
 expect(()=>encodeSourceArchive([{path:'large.wav',bytes:Buffer.alloc(150*1024*1024)}])).toThrow('ARCHIVE_INVALID');
});
it('T14 cannot bypass the privacy scan by renaming text to WAV or hiding credentials in WAV metadata',()=>{
 expect(()=>encodeSourceArchive([{path:'fake.wav',bytes:Buffer.from('Authorization: Bearer private')}])).toThrow('ARCHIVE_INVALID');
 const metadata=Buffer.from('Authorization: Bearer private '),wav=Buffer.alloc(12+24+8+metadata.length+8+4);
 wav.write('RIFF',0);wav.writeUInt32LE(wav.length-8,4);wav.write('WAVE',8);wav.write('fmt ',12);wav.writeUInt32LE(16,16);
 wav.write('LIST',36);wav.writeUInt32LE(metadata.length,40);metadata.copy(wav,44);wav.write('data',44+metadata.length);wav.writeUInt32LE(4,48+metadata.length);
 expect(()=>encodeSourceArchive([{path:'metadata.wav',bytes:wav}])).toThrow('ARCHIVE_PRIVATE_DATA');
});
it('T14 exports a verified frozen source closure, rejects cross-owner and changed objects without publishing a result',async()=>{
 const root=await mkdtemp(join(tmpdir(),'vb-source-archive-'));
 try{
  const projects=new ProjectStore(new FileStore(root)),owner='a'.repeat(64),created=await projects.create(owner,{schemaVersion:5,clientCreateId:randomUUID(),clientCommandId:randomUUID()}),projectId=created.projectId;
  const bundle=await seedPreviewBundle(projects,{projectId,revisionId:randomUUID(),durationSec:20,briefVersion:1,previewArtifactSha256:'b'.repeat(64)});
  const key=`projects/${projectId}/previews/${bundle.previewId}/manifest`;await projects.store.create(key,bundle);
  const before=(await projects.store.readFresh(`projects/${projectId}/control`)).etag;
  const first=await prepareFrozenSourceArchive(projects,owner,projectId,bundle.previewId,root),second=await prepareFrozenSourceArchive(projects,owner,projectId,bundle.previewId,root);
  expect(second.sha256).toBe(first.sha256);const files=unpack(first.bytes);
  expect(files['film.json']).toBe(bundle.filmSpecRef.sha256);
  expect(files['runtime/media/package-lock.json']).toBeDefined();expect(files['REBUILD.md']).toBeDefined();expect(files['font-fetch-manifest.json']).toBeDefined();
  expect(first.manifest.entries.some(e=>e.path.startsWith('source/'))).toBe(true);
  expect((await projects.store.readFresh(`projects/${projectId}/control`)).etag).toBe(before);
  await expect(prepareFrozenSourceArchive(projects,'c'.repeat(64),projectId,bundle.previewId,root)).rejects.toThrow('ACCESS_NOT_FOUND');
  const spec=(await projects.store.readFresh<{timelineRef:{key:string}}>(bundle.filmSpecRef.key)).value;
  const old=await projects.store.readFresh(spec.timelineRef.key);await projects.store.cas(spec.timelineRef.key,old.etag,{tampered:true});
  await expect(prepareFrozenSourceArchive(projects,owner,projectId,bundle.previewId,root)).rejects.toThrow('PREVIEW_PACKAGE_INVALID');
 }finally{await rm(root,{recursive:true,force:true})}
});
it('T14 refuses credentials supplied as otherwise valid frozen facts/script and rejects deleted projects',async()=>{
 const root=await mkdtemp(join(tmpdir(),'vb-source-privacy-'));
 try{
  const projects=new ProjectStore(new FileStore(root)),owner='a'.repeat(64),{projectId}=await projects.create(owner,{schemaVersion:5,clientCreateId:randomUUID(),clientCommandId:randomUUID()});
  const text='client_secret=oauth-secret-value-for-review',bundle=await seedPreviewBundle(projects,{projectId,revisionId:randomUUID(),durationSec:20,briefVersion:1,previewArtifactSha256:'b'.repeat(64),factTexts:[text],script:[text]});
  await projects.store.create(`projects/${projectId}/previews/${bundle.previewId}/manifest`,bundle);
  await expect(prepareFrozenSourceArchive(projects,owner,projectId,bundle.previewId,root)).rejects.toThrow('ARCHIVE_PRIVATE_DATA');
  await projects.tombstone(owner,projectId);
  await expect(prepareFrozenSourceArchive(projects,owner,projectId,bundle.previewId,root)).rejects.toThrow('ACCESS_NOT_FOUND');
 }finally{await rm(root,{recursive:true,force:true})}
});
