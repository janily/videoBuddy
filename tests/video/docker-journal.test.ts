import {afterEach,expect,it,vi} from 'vitest';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
const {docker}=vi.hoisted(()=>({docker:vi.fn()}));
vi.mock('node:child_process',async()=>{const actual=await vi.importActual<typeof import('node:child_process')>('node:child_process');return{...actual,spawn:(command:string,...args:unknown[])=>command==='docker'?docker(command,...args):Reflect.apply(actual.spawn,undefined,[command,...args])}});
import {FileStore} from '@/services/video/storage/file-store';
import {reserveDockerInvocation,finishDockerInvocation,stopJournaledDocker,dockerArgumentsHash,type DockerJournal} from '@/services/video/media/docker-journal';
import {runOwnedDocker} from '@/services/video/media/owned-docker';
const image='sha256:'+'a'.repeat(64),args=['run','--rm',image,'true'];let root:string;
async function fixture(){root=await mkdtemp(join(tmpdir(),'vb-docker-journal-'));return{store:new FileStore(root),prefix:`projects/${randomUUID()}/operations/${randomUUID()}/media-effects`} satisfies DockerJournal}
afterEach(async()=>{docker.mockReset();if(root)await rm(root,{recursive:true,force:true})});
it('persists the invocation before spawn and reuses a completed cold receipt without another container',async()=>{
 const journal=await fixture(),hash=dockerArgumentsHash(args,image);let starts=0;
 docker.mockImplementation((_command:string,argv:string[])=>{
  const task=Object.assign(new EventEmitter(),{stdout:new PassThrough(),stderr:new PassThrough()});
  if(argv[0]!=='run')throw Error('UNEXPECTED_CONTROL');starts++;
  void journal.store.readFresh<{invocation:string;state:string}>(journal.prefix+'/'+hash).then(({value})=>{expect(value.state).toBe('started');expect(argv[argv.indexOf('--name')+1]).toBe('vb-media-'+value.invocation);task.stdout.write('verified-output');task.emit('close',0)});
  return task;
 });
 expect(await runOwnedDocker(args,1000,image,undefined,journal)).toBe('verified-output');
 expect(await runOwnedDocker(args,1000,image,undefined,{...journal,store:new FileStore(root)})).toBe('verified-output');expect(starts).toBe(1);
});
it('never spawns after losing the acknowledgement of a started invocation',async()=>{
 const journal=await fixture(),create=journal.store.create.bind(journal.store);
 journal.store.create=async(key,value)=>{await create(key,value);throw Error('POWER_LOSS')};
 await expect(runOwnedDocker(args,1000,image,undefined,journal)).rejects.toMatchObject({message:'MEDIA_STOP_UNKNOWN',cause:{message:'POWER_LOSS'}});
 await expect(runOwnedDocker(args,1000,image,undefined,{...journal,store:new FileStore(root)})).rejects.toThrow('MEDIA_STOP_UNKNOWN');expect(docker).not.toHaveBeenCalled();
});
it('rechecks authorization after persisting an invocation and records zero producers when revoked',async()=>{
 const journal=await fixture(),create=journal.store.create.bind(journal.store);let revoked=false;
 journal.store.create=async(key,value)=>{await create(key,value);revoked=true};
 await expect(runOwnedDocker(args,1000,image,async()=>{if(revoked)throw Error('PREVIEW_STALE')},journal)).rejects.toThrow('PREVIEW_STALE');
 expect(docker).not.toHaveBeenCalled();
 expect((await journal.store.readFresh<{state:string}>(journal.prefix+'/'+dockerArgumentsHash(args,image))).value.state).toBe('stopped');
});
it.each(['foreign','daemon','absent'] as const)('retains unknown cold media without stopping an unverified container (%s)',async mode=>{
 const journal=await fixture(),record=await reserveDockerInvocation(journal,args,image),stops:string[][]=[];
 docker.mockImplementation((_command:string,argv:string[])=>{
  const task=Object.assign(new EventEmitter(),{stdout:new PassThrough(),stderr:new PassThrough()});
  queueMicrotask(()=>{if(argv[0]==='stop'){stops.push(argv);task.emit('close',0)}else if(argv[0]==='inspect'&&mode==='foreign'){task.stdout.write('b'.repeat(64)+' '+image+' '+randomUUID()+' '+record.argsSha256+' true running no');task.emit('close',0)}else task.emit('close',mode==='daemon'?1:argv[0]==='ps'?0:1)});return task;
 });
 await expect(stopJournaledDocker(journal,record.argsSha256,image)).rejects.toThrow('MEDIA_STOP_UNKNOWN');expect(stops).toEqual([]);
 expect((await journal.store.readFresh<{state:string}>(journal.prefix+'/'+record.argsSha256)).value.state).toBe('unknown');
});
it('stops only the persisted invocation and archives a verified cold stop',async()=>{
 const journal=await fixture(),record=await reserveDockerInvocation(journal,args,image),id='b'.repeat(64),stops:string[][]=[];let running=true;
 docker.mockImplementation((_command:string,argv:string[])=>{const task=Object.assign(new EventEmitter(),{stdout:new PassThrough(),stderr:new PassThrough()});queueMicrotask(()=>{if(argv[0]==='inspect'){expect(argv.at(-1)).toBe('vb-media-'+record.invocation);task.stdout.write([id,image,record.invocation,record.argsSha256,running,running?'running':'exited','no'].join(' '))}else if(argv[0]==='stop'){stops.push(argv);running=false}else throw Error('UNEXPECTED_CONTROL');task.emit('close',0)});return task});
 await stopJournaledDocker(journal,record.argsSha256,image);expect(stops).toEqual([['stop','--time','10',id]]);
 expect((await journal.store.readFresh<{state:string}>(journal.prefix+'/'+record.argsSha256)).value.state).toBe('stopped');
 await expect(reserveDockerInvocation(journal,args,image)).rejects.toThrow('MEDIA_EXECUTION_INTERRUPTED');
});
it.each(['created','restarting'])('does not infer stopped from Running=false in Docker state %s',async state=>{
 const journal=await fixture(),record=await reserveDockerInvocation(journal,args,image);
 docker.mockImplementation((_command:string,argv:string[])=>{const task=Object.assign(new EventEmitter(),{stdout:new PassThrough(),stderr:new PassThrough()});queueMicrotask(()=>{expect(argv[0]).toBe('inspect');task.stdout.write(['b'.repeat(64),image,record.invocation,record.argsSha256,false,state,'no'].join(' '));task.emit('close',0)});return task});
 await expect(stopJournaledDocker(journal,record.argsSha256,image)).rejects.toThrow('MEDIA_STOP_UNKNOWN');
 expect((await journal.store.readFresh<{state:string}>(journal.prefix+'/'+record.argsSha256)).value.state).toBe('unknown');
});
it('recovers a fixed completed receipt after lost CAS acknowledgement without consulting an unavailable daemon',async()=>{
 const journal=await fixture(),cas=journal.store.cas.bind(journal.store);let lost=false;
 journal.store.cas=async(key,etag,value)=>{await cas(key,etag,value);if(!lost&&(value as {state:string}).state==='completed'){lost=true;throw Error('ACK_LOST')}};
 docker.mockImplementation((_command:string,argv:string[])=>{const task=Object.assign(new EventEmitter(),{stdout:new PassThrough(),stderr:new PassThrough()});queueMicrotask(()=>{if(argv[0]==='run'){task.stdout.write('done');task.emit('close',0)}else task.emit('close',1)});return task});
 expect(await runOwnedDocker(args,1000,image,undefined,journal)).toBe('done');
 expect(docker.mock.calls.map(([,argv])=>argv[0])).toEqual(['run']);
});
it('does not replace a fixed completion with a later unknown observation',async()=>{
 const journal=await fixture(),record=await reserveDockerInvocation(journal,args,image);
 await finishDockerInvocation(journal,record,'completed','done');await finishDockerInvocation(journal,record,'unknown');
 expect((await reserveDockerInvocation(journal,args,image)).output).toBe('done');
});
it('allows only one concurrent journal producer',async()=>{
 const journal=await fixture();let starts=0;
 docker.mockImplementation((_command:string,argv:string[])=>{expect(argv[0]).toBe('run');starts++;const task=Object.assign(new EventEmitter(),{stdout:new PassThrough(),stderr:new PassThrough()});setTimeout(()=>{task.stdout.write('done');task.emit('close',0)},100);return task});
 const outcomes=await Promise.allSettled([runOwnedDocker(args,1000,image,undefined,journal),runOwnedDocker(args,1000,image,undefined,{...journal,store:new FileStore(root)})]);
 expect(starts).toBe(1);expect(outcomes.filter(result=>result.status==='fulfilled')).toHaveLength(1);
 const rejected=outcomes.find(result=>result.status==='rejected');expect(rejected).toMatchObject({reason:{message:'MEDIA_STOP_UNKNOWN'}});
});
it('retains unknown when an existing invocation identity is corrupted',async()=>{
 const journal=await fixture(),record=await reserveDockerInvocation(journal,args,image),key=journal.prefix+'/'+record.argsSha256,{etag}=await journal.store.readFresh(key);
 await journal.store.cas(key,etag,{...record,image:'sha256:'+'c'.repeat(64)});
 await expect(runOwnedDocker(args,1000,image,undefined,journal)).rejects.toThrow('MEDIA_STOP_UNKNOWN');expect(docker).not.toHaveBeenCalled();
});
it('recovers a fixed cold stop after losing its persistence acknowledgement',async()=>{
 const journal=await fixture(),record=await reserveDockerInvocation(journal,args,image),cas=journal.store.cas.bind(journal.store);let lost=false;
 journal.store.cas=async(key,etag,value)=>{await cas(key,etag,value);if(!lost&&(value as {state:string}).state==='stopped'){lost=true;throw Error('ACK_LOST')}};
 docker.mockImplementation((_command:string,argv:string[])=>{expect(argv[0]).toBe('inspect');const task=Object.assign(new EventEmitter(),{stdout:new PassThrough(),stderr:new PassThrough()});queueMicrotask(()=>{task.stdout.write(['b'.repeat(64),image,record.invocation,record.argsSha256,false,'exited','no'].join(' '));task.emit('close',0)});return task});
 expect((await stopJournaledDocker(journal,record.argsSha256,image)).state).toBe('stopped');expect(docker).toHaveBeenCalledTimes(1);
});
it('does not commit a warm stop for a created container while its attached client can still start it',async()=>{
 const journal=await fixture();let revoked=false,client:ReturnType<typeof task>|undefined,notifyStarted!:()=>void;const started=new Promise<void>(resolve=>{notifyStarted=resolve});
 function task(){return Object.assign(new EventEmitter(),{stdout:new PassThrough(),stderr:new PassThrough()})}
 docker.mockImplementation((_command:string,argv:string[])=>{
  const child=task();if(argv[0]==='run'){client=child;notifyStarted();return child}
  void journal.store.readFresh<{invocation:string;argsSha256:string}>(journal.prefix+'/'+dockerArgumentsHash(args,image)).then(({value})=>{if(argv[0]==='inspect')child.stdout.write(['b'.repeat(64),image,value.invocation,value.argsSha256,...(argv.includes('--format')&&argv[argv.indexOf('--format')+1].includes('.State.Status')?[false,'created','no']:[])].join(' '));child.emit('close',0)});return child;
 });
 const result=runOwnedDocker(args,5000,image,async()=>{if(revoked)throw Error('PREVIEW_STALE')},journal).catch(error=>error);
 await started;revoked=true;const deadline=Date.now()+3000;let state='started';
 while(state==='started'&&Date.now()<deadline){await new Promise(resolve=>setTimeout(resolve,20));state=(await journal.store.readFresh<{state:string}>(journal.prefix+'/'+dockerArgumentsHash(args,image))).value.state}
 client!.emit('close',0);const error=await result;
 expect(state).toBe('unknown');expect(error.message).toBe('MEDIA_STOP_UNKNOWN');expect(docker.mock.calls.some(([,argv])=>argv[0]==='stop')).toBe(false);
});
