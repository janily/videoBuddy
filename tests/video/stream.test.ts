import { describe,it,expect } from 'vitest';
import { SseParser,parseCursor } from '@/services/video/stream/sse-parser';
import { reduceEvent,initialStreamState } from '@/services/video/stream/reducer';
import { StreamEventSchema } from '@/contracts/video/commands';
const ids={projectId:'10000000-0000-4000-8000-000000000001',operationId:'10000000-0000-4000-8000-000000000002',messageId:'10000000-0000-4000-8000-000000000003'};
function event(type:string,payload:object,epoch=0){return StreamEventSchema.parse({schemaVersion:5,projectId:ids.projectId,operationId:ids.operationId,epoch,eventId:crypto.randomUUID(),type,createdAt:'2026-10-02T00:00:00Z',payload})}
describe('T04 SSE bytes and cursors',()=>{
 it('AT-013 handles every UTF8 split and CRLF boundary',()=>{
  const bytes=new TextEncoder().encode('id: 0:0\r\nevent: video\r\ndata: {"text":"中文😀"}\r\n\r\n');
  for(let split=1;split<bytes.length;split++){
   const parser=new SseParser();const records=[...parser.push(bytes.slice(0,split)),...parser.push(bytes.slice(split))];
   expect(records).toEqual([{id:'0:0',event:'video',data:'{"text":"中文😀"}'}]);
  }
 });
 it('retains a trailing half-event and supports multi-line data',()=>{
  const p=new SseParser();expect(p.push(new TextEncoder().encode(': ping\ndata: one\ndata: two\n'))).toEqual([]);
  expect(p.push(new TextEncoder().encode('\n'))).toEqual([{id:'',event:'message',data:'one\ntwo'}]);
 });
 it('AT-067 rejects malformed, negative and unsafe cursors',()=>{
  for(const c of ['-1:0','0:-1','x:1','0:9007199254740992','1:2:3']) expect(()=>parseCursor(c)).toThrow('CURSOR_INVALID');
  expect(parseCursor('0:12')).toEqual({epoch:0,index:12});
 });
});
describe('T04 message reducer',()=>{
 it('AT-014 a reset replaces model attempt; old deltas cannot revive',()=>{
  let s=initialStreamState(ids.operationId,0);
  s=reduceEvent(s,event('message.started',{messageId:ids.messageId,contentVersion:1,role:'assistant',ordinal:2}),0);
  s=reduceEvent(s,event('message.delta',{messageId:ids.messageId,contentVersion:1,offset:0,text:'旧回答'}),1);
  s=reduceEvent(s,event('message.reset',{messageId:ids.messageId,contentVersion:2,text:'新回答'}),2);
  s=reduceEvent(s,event('message.delta',{messageId:ids.messageId,contentVersion:1,offset:3,text:'不能追加'}),3);
  expect(s.messages[ids.messageId].text).toBe('新回答');
 });
 it('AT-069 identical replay deduplicates, inconsistent overlap requires checkpoint',()=>{
  let s=initialStreamState(ids.operationId,0);
  s=reduceEvent(s,event('message.started',{messageId:ids.messageId,contentVersion:1,role:'assistant',ordinal:1}),0);
  const delta=event('message.delta',{messageId:ids.messageId,contentVersion:1,offset:0,text:'中文😀'});
  s=reduceEvent(s,delta,1);s=reduceEvent(s,delta,1);
  s=reduceEvent(s,event('message.delta',{messageId:ids.messageId,contentVersion:1,offset:0,text:'中文😀'}),2);
  expect(s.messages[ids.messageId].text).toBe('中文😀');
  const previous=s.cursor;
  s=reduceEvent(s,event('message.delta',{messageId:ids.messageId,contentVersion:1,offset:2,text:'别的'}),3);
  expect(s.needsCheckpoint).toBe(true);expect(s.cursor).toEqual(previous);
 });
 it('gaps and new epoch reset require a checkpoint without invented tokens',()=>{
  let s=initialStreamState(ids.operationId,0);
  s=reduceEvent(s,event('message.started',{messageId:ids.messageId,contentVersion:1,role:'assistant',ordinal:1}),0);
  s=reduceEvent(s,event('message.delta',{messageId:ids.messageId,contentVersion:1,offset:10,text:'未知'}),1);
  expect(s.needsCheckpoint).toBe(true);expect(s.messages[ids.messageId].text).toBe('');
  s=reduceEvent(s,event('message.delta',{messageId:ids.messageId,contentVersion:1,offset:0,text:'另一轮'},1),0);
  expect(s.needsCheckpoint).toBe(true);expect(s.epoch).toBe(1);expect(s.messages).toEqual({});
 });
 it('rejects deltas belonging to another operation',()=>{
  const s=initialStreamState('20000000-0000-4000-8000-000000000002',0);
  expect(reduceEvent(s,event('message.started',{messageId:ids.messageId,contentVersion:1,role:'assistant',ordinal:1}),0)).toBe(s);
 });
});
