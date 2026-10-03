import {afterEach,expect,it,vi} from 'vitest';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
const {spawn}=vi.hoisted(()=>({spawn:vi.fn()}));
vi.mock('node:child_process',()=>({spawn}));
import {runOwnedDocker} from '@/services/video/media/owned-docker';
afterEach(()=>{vi.useRealTimers();spawn.mockReset()});
function docker(mode:'stopped'|'stop_failed'|'foreign'|'daemon'|'gone'|'confirmed_then_daemon'|'stop_timeout_then_success'|'concurrent_timeout'){
 const image='sha256:'+'a'.repeat(64),stops:string[][]=[];let invocation='',name='',inspections=0;
 spawn.mockImplementation((_command:string,args:string[])=>{
  const child=Object.assign(new EventEmitter(),{stdout:new PassThrough(),stderr:new PassThrough()});
  if(args[0]==='run'){
   invocation=args[args.indexOf('--label')+1].split('=')[1];name=args[args.indexOf('--name')+1];setTimeout(()=>child.emit('close',0),1000);
   if(mode==='concurrent_timeout')setTimeout(()=>child.emit('error',Error('RUN_TIMEOUT')),600);
  }else if(args[0]==='inspect'){
   inspections++;
   expect(args.at(-1)).toBe(name);
   setTimeout(()=>{if(mode==='daemon'||mode==='gone'||(mode==='confirmed_then_daemon'||mode==='concurrent_timeout')&&inspections>1)child.emit('close',1);else{child.stdout.write('container-id '+(mode==='foreign'?'sha256:'+'b'.repeat(64):image)+' '+invocation);child.emit('close',0)}},0);
  }else if(args[0]==='ps'){
   expect(args.at(-1)).toBe('name=^/'+name+'$');setTimeout(()=>child.emit('close',mode==='daemon'||mode==='confirmed_then_daemon'||mode==='concurrent_timeout'?1:0),0);
  }else if(args[0]==='stop'){
   stops.push(args);const first=stops.length===1;setTimeout(()=>{if(mode==='stop_timeout_then_success'&&first)child.emit('error',Error('STOP_TIMEOUT'));child.emit('close',mode==='stop_failed'?1:0)},mode==='concurrent_timeout'?200:0);
  }else throw Error('UNEXPECTED_DOCKER_COMMAND');
  return child;
 });
 return{image,stops};
}
it.each(['stop_failed','foreign','daemon','stop_timeout_then_success'] as const)('preserves unknown physical stop when authorization is revoked (%s)',async mode=>{
 vi.useFakeTimers();const {image,stops}=docker(mode);let checks=0;
 const result=runOwnedDocker(['run','--rm',image,'true'],2000,image,async()=>{if(++checks>1)throw Error('RENDER_FENCED')});
 const error=result.catch(error=>error);await vi.advanceTimersByTimeAsync(1500);expect((await error).message).toBe('MEDIA_STOP_UNKNOWN');
 if(mode==='stop_failed'||mode==='stop_timeout_then_success')expect(stops.length).toBeGreaterThan(0);else expect(stops).toHaveLength(0);
});
it('accepts absence only after the attached run closes normally and the daemon confirms the exact name is absent',async()=>{
 vi.useFakeTimers();const {image,stops}=docker('gone');let checks=0;
 const error=runOwnedDocker(['run','--rm',image,'true'],2000,image,async()=>{if(++checks>1)throw Error('RENDER_FENCED')}).catch(error=>error);
 await vi.advanceTimersByTimeAsync(1500);expect((await error).message).toBe('RENDER_FENCED');expect(stops).toHaveLength(0);
 expect(spawn.mock.calls.some(([,args])=>args[0]==='ps')).toBe(true);
});
it('does not change a confirmed stop into unknown when the daemon later becomes unavailable',async()=>{
 vi.useFakeTimers();const {image,stops}=docker('confirmed_then_daemon');let checks=0;
 const error=runOwnedDocker(['run','--rm',image,'true'],2000,image,async()=>{if(++checks>1)throw Error('RENDER_FENCED')}).catch(error=>error);
 await vi.advanceTimersByTimeAsync(1500);expect((await error).message).toBe('RENDER_FENCED');expect(stops).toHaveLength(1);
 expect(spawn.mock.calls.filter(([,args])=>args[0]==='inspect')).toHaveLength(1);
});
it('shares an in-flight stop between authorization revocation and attached process timeout',async()=>{
 vi.useFakeTimers();const {image,stops}=docker('concurrent_timeout');let checks=0;
 const error=runOwnedDocker(['run','--rm',image,'true'],2000,image,async()=>{if(++checks>1)throw Error('RENDER_FENCED')}).catch(error=>error);
 await vi.advanceTimersByTimeAsync(1500);expect((await error).message).toBe('RUN_TIMEOUT');expect(stops).toHaveLength(1);
 expect(spawn.mock.calls.filter(([,args])=>args[0]==='inspect')).toHaveLength(1);
});
it('retains the authorization error only after the owned container stop succeeds',async()=>{
 vi.useFakeTimers();const {image,stops}=docker('stopped');let checks=0;
 const result=runOwnedDocker(['run','--rm',image,'true'],2000,image,async()=>{if(++checks>1)throw Error('RENDER_FENCED')});
 const error=result.catch(error=>error);await vi.advanceTimersByTimeAsync(1500);expect((await error).message).toBe('RENDER_FENCED');
 expect(stops[0]).toEqual(['stop','--time','10','container-id']);
});
