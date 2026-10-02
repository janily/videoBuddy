import { describe,it,expect,beforeEach,afterEach } from 'vitest';
import { mkdtemp,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { FileStore } from './helpers/file-store';
import { updateJson } from '@/services/video/storage/atomic-store';
import { Admission } from '@/services/video/storage/admission';
import { issueSession,verifySession,ownerHash,assertOwner,assertWriteOrigin } from '@/services/video/access/session';
let dir:string;
beforeEach(async()=>{dir=await mkdtemp(`${tmpdir()}/videobuddy-`)});
afterEach(async()=>{await rm(dir,{recursive:true,force:true})});
describe('T02 durable conditional store',()=>{
 it('AT-065 only one create succeeds and a losing initializer cannot overwrite',async()=>{
  const a=new FileStore(dir),b=new FileStore(dir);
  const results=await Promise.allSettled([a.create('control',{title:'first'}),b.create('control',{title:'second'})]);
  expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);
  expect((await a.readFresh<{title:string}>('control')).value.title).toMatch(/first|second/);
 });
 it('AT-008 both independently computed pointer changes survive CAS collision',async()=>{
  const a=new FileStore(dir),b=new FileStore(dir);
  await a.create('control',{controlVersion:0,messages:[] as string[],result:''});
  await Promise.all([updateJson(a,'control',(c:{controlVersion:number;messages:string[];result:string})=>({...c,controlVersion:c.controlVersion+1,messages:[...c.messages,'message']})), updateJson(b,'control',(c:{controlVersion:number;messages:string[];result:string})=>({...c,controlVersion:c.controlVersion+1,result:'artifact'}))]);
  expect((await new FileStore(dir).readFresh('control')).value).toEqual({controlVersion:2,messages:['message'],result:'artifact'});
 });
 it('AT-064 a cold instance reads a committed archive',async()=>{
  await new FileStore(dir).create('archive',{text:'新消息'});
  expect((await new FileStore(dir).readFresh('archive')).value).toEqual({text:'新消息'});
 });
 it('does not retry semantic failures as write conflicts',async()=>{
  const store=new FileStore(dir);await store.create('control',{version:1});
  await expect(updateJson(store,'control',()=>{throw new Error('PREVIEW_STALE')})).rejects.toThrow('PREVIEW_STALE');
 });
 it('AT-009 retains uncertain expired reservations; stale release cannot free a new one',async()=>{
  const store=new FileStore(dir);const a=new Admission(store,'admission');
  const first=await a.reserve('A','op-a');
  const requests=await Promise.allSettled([a.reserve('A','op-b'),a.reserve('B','op-c'),a.reserve('C','op-d')]);
  const grants=[first,...requests.flatMap(r=>r.status==='fulfilled'?[r.value]:[])];
  expect(grants).toHaveLength(2);expect(grants.filter(g=>g.owner==='A')).toHaveLength(1);
  await expect(a.reserve('D','op-e')).rejects.toThrow('CAPACITY_LIMIT');
  await a.release(grants[0].id,'wrong-reservation',true);
  await expect(a.reserve('D','op-e')).rejects.toThrow('CAPACITY_LIMIT');
  await a.release(grants[0].id,grants[0].reservationId,false);
  await expect(a.reserve('D','op-e')).rejects.toThrow('CAPACITY_LIMIT');
  await a.release(grants[0].id,grants[0].reservationId,true);
  expect((await a.reserve('D','op-e')).owner).toBe('D');
 });
});
describe('T02 anonymous scope',()=>{
 const keys={current:'x'.repeat(64),keyId:'v1',environment:'preview-main'};
 it('AT-007 foreign scope sees only ACCESS_NOT_FOUND',()=>{
  const a=issueSession(keys),b=issueSession(keys);
  expect(()=>assertOwner(ownerHash(verifySession(a.token,keys).sid,keys),ownerHash(verifySession(b.token,keys).sid,keys))).toThrow('ACCESS_NOT_FOUND');
 });
 it('rejects tampering, expiration and cross-environment cookies',()=>{
  const session=issueSession(keys,1000);
  expect(()=>verifySession(session.token+'x',keys,1000)).toThrow('ACCESS_NOT_FOUND');
  expect(()=>verifySession(session.token,keys,session.expiresAt+1)).toThrow('ACCESS_NOT_FOUND');
  expect(()=>verifySession(session.token,{...keys,environment:'production'},1000)).toThrow('ACCESS_NOT_FOUND');
 });
 it('key rotation retains scope identity while refreshing the same sid',()=>{
  const old=issueSession(keys,1000);const next={...keys,current:'y'.repeat(64),keyId:'v2',previous:keys.current,previousKeyId:'v1'};
  const decoded=verifySession(old.token,next,2000);
  const refreshed=issueSession(next,2000,decoded.sid);
  expect(verifySession(refreshed.token,next,2000).sid).toBe(decoded.sid);
  expect(ownerHash(decoded.sid,keys)).toBe(ownerHash(decoded.sid,next));
 });
 it('rejects cross-origin writes and localhost exceptions in production',()=>{
  expect(()=>assertWriteOrigin(new Request('https://app.test/api',{headers:{origin:'https://evil.test'}}),'https://app.test','production')).toThrow('ORIGIN_FORBIDDEN');
  expect(()=>assertWriteOrigin(new Request('http://localhost/api',{headers:{origin:'http://localhost'}}),'http://localhost','production')).toThrow('ORIGIN_FORBIDDEN');
 });
});
