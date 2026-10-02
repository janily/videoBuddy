import{afterEach,beforeEach,expect,it}from'vitest';
import{mkdtemp,rm}from'node:fs/promises';import{tmpdir}from'node:os';import{join}from'node:path';
import{LocalEventLog}from'@/services/video/stream/local-event-log';
let dir:string;beforeEach(async()=>{dir=await mkdtemp(join(tmpdir(),'vb-events-'))});afterEach(async()=>{await rm(dir,{recursive:true,force:true})});
const projectId='10000000-0000-4000-8000-000000000001',operationId='20000000-0000-4000-8000-000000000002';
function event(text:string){return{schemaVersion:5 as const,projectId,operationId,epoch:0,eventId:crypto.randomUUID(),type:'message.delta' as const,createdAt:new Date().toISOString(),payload:{messageId:'30000000-0000-4000-8000-000000000003',contentVersion:1,offset:0,text}}}
it('two cold processes append in one ordered durable log, with no lost event',async()=>{
 const a=new LocalEventLog(dir),b=new LocalEventLog(dir);await Promise.all([a.append(event('中文甲')),b.append(event('中文乙'))]);
 const fresh=new LocalEventLog(dir);const first=await fresh.readFrom(projectId,operationId,0);expect(first.map(x=>x.event.type==='message.delta'?x.event.payload.text:'').sort()).toEqual(['中文乙','中文甲'].sort());
 expect(first.map(x=>x.index)).toEqual([0,1]);expect((await fresh.readFrom(projectId,operationId,1)).map(x=>x.index)).toEqual([1]);
});
it('invalid cursor and foreign operation cannot read another private log',async()=>{
 const a=new LocalEventLog(dir);await a.append(event('真实内容'));await expect(a.readFrom(projectId,operationId,-1)).rejects.toThrow('CURSOR_INVALID');
 expect(await a.readFrom(projectId,'40000000-0000-4000-8000-000000000004',0)).toEqual([]);
});
