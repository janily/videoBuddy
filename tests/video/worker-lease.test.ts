import{afterEach,beforeEach,expect,it}from'vitest';import{mkdtemp,rm}from'node:fs/promises';import{tmpdir}from'node:os';import{join}from'node:path';
import{acquireWorkerLease}from'@/services/video/commands/worker-lease';
let dir:string;beforeEach(async()=>{dir=await mkdtemp(join(tmpdir(),'vb-lease-'))});afterEach(async()=>{await rm(dir,{recursive:true,force:true})});
it('only one process may execute paid effects; release permits the next worker',async()=>{
 const first=await acquireWorkerLease(dir);
 try{await expect(acquireWorkerLease(dir)).rejects.toThrow('WORKER_BUSY')}finally{await first.release()}
 const second=await acquireWorkerLease(dir);await second.release();
});
