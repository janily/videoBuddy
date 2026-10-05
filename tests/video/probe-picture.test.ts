import {expect,it,vi} from 'vitest';
import {observeProbePicture} from '../../scripts/video/helpers/probe-picture';
import type {MediaExecutor,MediaJob} from '@/services/video/media/executor';
const handle={containerId:'a'.repeat(64),containerName:'vb-fixture',stageKey:'b'.repeat(64),runtimeDigest:'c'.repeat(64)};
const job:MediaJob={projectId:'protocol-project',operationId:'protocol-operation',attemptId:'attempt',stageKey:handle.stageKey,bundleHash:'d'.repeat(64),runtimeDigest:handle.runtimeDigest,sourceHtml:'protocol fixture',logicalWidth:1920,logicalHeight:1080,outputWidth:1920,outputHeight:1080,fps:24,startFrame:0,endFrame:120,seed:1,fence:0};
function fixture(){return{submit:vi.fn(async()=>handle),inspect:vi.fn(async()=>({status:'succeeded' as const,outputs:['output/picture.mp4']})),cancel:vi.fn(async()=>({status:'cancelled' as const}))} satisfies MediaExecutor}
it('stops exactly the started handle when recording it fails, before inspecting or accepting picture output',async()=>{
 const executor=fixture(),failure=Error('PROBE_REPORT_IO_FAILED');
 await expect(observeProbePicture(executor,job,async()=>{throw failure},async()=>{},1000)).rejects.toBe(failure);
 expect(executor.cancel).toHaveBeenCalledExactlyOnceWith(handle);expect(executor.inspect).not.toHaveBeenCalled();
});
it('preserves unknown stop status for thrown and inconclusive stop acknowledgments',async()=>{
 for(const cancel of [async()=>{throw Error('DAEMON_UNAVAILABLE')},async()=>({status:'cancelling' as const})]){
  const executor:MediaExecutor={...fixture(),cancel};
  await expect(observeProbePicture(executor,job,async()=>{throw Error('PROBE_REPORT_IO_FAILED')},async()=>{},1000)).rejects.toThrow('MEDIA_STOP_UNKNOWN');
 }
});
it('checks the source fence after completion and stops its own handle if that fence changed',async()=>{
 const executor=fixture(),guard=vi.fn(async()=>{throw Error('SOURCE_CHANGED')});
 await expect(observeProbePicture(executor,job,async()=>{},guard,1000)).rejects.toThrow('SOURCE_CHANGED');
 expect(executor.cancel).toHaveBeenCalledExactlyOnceWith(handle);
});
it('accepts only a terminal failed negative probe and stops on its report failure',async()=>{
 const executor:MediaExecutor={...fixture(),inspect:vi.fn(async()=>({status:'failed' as const,outputs:[]}))};
 const result=await observeProbePicture(executor,job,async()=>{},async()=>{},1000,'failed');
 expect(result).toEqual(handle);
 const failure=Error('NEGATIVE_REPORT_IO_FAILED');
 await expect(observeProbePicture(executor,job,async()=>{throw failure},async()=>{},1000,'failed')).rejects.toBe(failure);
 expect(executor.cancel).toHaveBeenCalledExactlyOnceWith(handle);
});
it('preserves unknown cleanup on negative probes and rejects output-bearing failures',async()=>{
 const executor:MediaExecutor={...fixture(),cancel:async()=>({status:'cancelling'})};
 await expect(observeProbePicture(executor,job,async()=>{throw Error('REPORT_IO')},async()=>{},1000,'failed')).rejects.toThrow('MEDIA_STOP_UNKNOWN');
 const invalid:MediaExecutor={...fixture(),inspect:async()=>({status:'failed',outputs:['output/picture.mp4']})};
 await expect(observeProbePicture(invalid,job,async()=>{},async()=>{},1000,'failed')).rejects.toThrow('CLEAR_FULL_FILM_PICTURE_FAILED');
 expect(invalid.cancel).toHaveBeenCalledExactlyOnceWith(handle);
});
