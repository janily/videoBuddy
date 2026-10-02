import {afterEach,beforeEach,expect,it} from 'vitest';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {FileStore} from '@/services/video/storage/file-store';
import {StoreConflict,StoreMissing} from '@/services/video/storage/atomic-store';
let dir:string;
beforeEach(async()=>{dir=await mkdtemp(join(tmpdir(),'vb-self-host-'))});
afterEach(async()=>{await rm(dir,{recursive:true,force:true})});
it('two cold adapters race create and CAS without losing the winner',async()=>{
 const a=new FileStore(dir),b=new FileStore(dir);
 const creates=await Promise.allSettled([a.create('projects/p/control',{n:1}),b.create('projects/p/control',{n:2})]);
 expect(creates.filter(r=>r.status==='fulfilled')).toHaveLength(1);
 const current=await a.readFresh<{n:number}>('projects/p/control');
 const writes=await Promise.allSettled([a.cas('projects/p/control',current.etag,{n:3}),b.cas('projects/p/control',current.etag,{n:4})]);
 expect(writes.filter(r=>r.status==='fulfilled')).toHaveLength(1);
 expect(writes.filter(r=>r.status==='rejected'&&(r.reason instanceof StoreConflict))).toHaveLength(1);
 expect([3,4]).toContain((await new FileStore(dir).readFresh<{n:number}>('projects/p/control')).value.n);
});
it('wrong key and missing state never escape the volume or become a new record',async()=>{
 const store=new FileStore(dir);
 expect(()=>store.path('../secret')).toThrow('INVALID_KEY');
 await expect(store.readFresh('projects/missing')).rejects.toBeInstanceOf(StoreMissing);
 await expect(store.cas('projects/missing','x',{n:1})).rejects.toBeInstanceOf(StoreMissing);
 expect(await readFile(join(dir,'projects/missing.json')).catch(()=>null)).toBeNull();
});
it('a writer killed while holding its OS lock does not block the next CAS',async()=>{
 const store=new FileStore(dir);await store.create('projects/p/control',{n:1});
 const lockPath=store.path('projects/p/control')+'.lock';
 const child=spawn('python3',['-u','-c','import fcntl,sys,time; f=open(sys.argv[1],"a+"); fcntl.flock(f,fcntl.LOCK_EX); print("locked",flush=True); time.sleep(60)',lockPath],{stdio:['ignore','pipe','pipe']});
 await new Promise<void>((resolve,reject)=>{child.stdout.once('data',()=>resolve());child.once('error',reject)});
 const etag=(await store.readFresh<{n:number}>('projects/p/control')).etag;
 const pending=store.cas('projects/p/control',etag,{n:2});
 await new Promise(resolve=>setTimeout(resolve,80));
 child.kill('SIGKILL');await new Promise(resolve=>child.once('exit',resolve));
 await expect(pending).resolves.toBeUndefined();
 expect((await store.readFresh<{n:number}>('projects/p/control')).value.n).toBe(2);
});
