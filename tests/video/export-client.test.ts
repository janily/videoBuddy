import {describe,it,expect} from 'vitest';
import {parseExportIntent,validateDownloadAccess} from '@/services/video/exports/client-contract';
const projectId='10000000-0000-4000-8000-000000000001',artifactId='20000000-0000-4000-8000-000000000002';
const request={schemaVersion:5,clientCommandId:crypto.randomUUID(),artifactId,format:'poster'};
describe('export browser boundary',()=>{
 it('restores only a bounded, input-bound command, never a signed URL',()=>{
  expect(parseExportIntent(JSON.stringify({version:1,request}),artifactId)?.request).toEqual(request);
  expect(parseExportIntent(JSON.stringify({version:1,request,access:{url:'secret'}}),artifactId)).toBeNull();
  expect(parseExportIntent(JSON.stringify({version:1,request}),projectId)).toBeNull();
  expect(parseExportIntent(' '.repeat(5000),artifactId)).toBeNull();
 });
 it('accepts only a fresh download for the authorized returned artifact',()=>{
  const access={url:`/api/video/projects/${projectId}/artifacts/${artifactId}/file?purpose=download&token=test`,purpose:'download',filename:'video.mp4',mime:'video/mp4',expiresAt:new Date(Date.now()+180000).toISOString()};
  expect(validateDownloadAccess(access,projectId,artifactId,'https://local.test').filename).toBe('video.mp4');
  for(const patch of [{url:'javascript:alert(1)'},{url:'https://elsewhere.test/file'},{purpose:'play'},{expiresAt:'2000-01-01T00:00:00Z'},{filename:'bad\r\nname'},{url:access.url.replace(artifactId,projectId)}])expect(()=>validateDownloadAccess({...access,...patch},projectId,artifactId,'https://local.test')).toThrow();
 });
});
