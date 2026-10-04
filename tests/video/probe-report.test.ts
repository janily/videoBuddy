import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {expect,it} from 'vitest';
import {claimProbeReport,persistProbeReport} from '../../scripts/video/helpers/probe-report';
it('admits one concurrent producer and preserves the started admission for cold refusal',async()=>{
 const root=await mkdtemp(join(tmpdir(),'vb-probe-admission-')),path=join(root,'report.json');
 try{
 const results=await Promise.allSettled(Array.from({length:8},(_,invocation)=>claimProbeReport(path,{status:'started',invocation})));
 expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);
 const initial=JSON.parse(await readFile(path,'utf8'));expect(initial.status).toBe('started');
 await expect(claimProbeReport(path,{status:'new_attempt'})).rejects.toThrow('PROBE_ALREADY_RECORDED_NO_AUTOMATIC_RETRY');
 await persistProbeReport(path,{...initial,status:'failed',errorCode:'MEDIA_STOP_UNKNOWN'});
 await expect(claimProbeReport(path,{status:'retry'})).rejects.toThrow('PROBE_ALREADY_RECORDED_NO_AUTOMATIC_RETRY');
 expect(JSON.parse(await readFile(path,'utf8'))).toEqual({...initial,status:'failed',errorCode:'MEDIA_STOP_UNKNOWN'});
 }finally{await rm(root,{recursive:true,force:true})}
});
