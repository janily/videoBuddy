import {it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import {sceneResources} from '@/services/video/media/local/resources';
it('serves only the declared byte graph and blocks foreign resources over real HTTP',async()=>{
 const id=randomUUID(),data=Buffer.from('owned immutable image'),server=await sceneResources('<html>scene</html>',new Map([['/assets/'+id+'.bin',{data,mime:'image/png'}]]),[]);
 try{
  const response=await fetch(server.origin+'/assets/'+id+'.bin');expect(response.status).toBe(200);expect(response.headers.get('content-type')).toBe('image/png');expect(Buffer.from(await response.arrayBuffer())).toEqual(data);
  for(const path of ['/assets/foreign.bin','/assets/'+randomUUID()+'.bin','/job.json','/assets/%2e%2e/job.json'])expect((await fetch(server.origin+path)).status).toBe(404);
  expect((await fetch(server.origin+'/scene.html')).status).toBe(200);expect((await fetch(server.origin+'/assets/'+id+'.bin',{method:'POST'})).status).toBe(404);
  expect((await fetch(server.origin+'/scene.html')).headers.get('content-security-policy')).toContain("connect-src 'none'");
  expect(server.allowed).toEqual(new Set([server.origin+'/scene.html',server.origin+'/assets/'+id+'.bin']));
 }finally{await server.close()}
});
