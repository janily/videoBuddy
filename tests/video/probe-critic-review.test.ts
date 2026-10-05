import {it,expect} from 'vitest';
import {runAndArchiveProbeReview} from '../../scripts/video/helpers/probe-critic-review';
it('stops the batch loop after archive acknowledgement loss',async()=>{
 let calls=0;
 async function loop(){for(let n=0;n<2;n++)await runAndArchiveProbeReview(async()=>{calls++;return{result:'pass'}},async()=>{throw Error('EIO_FSYNC_ACK_LOST')})}
 await expect(loop()).rejects.toThrow('EIO_FSYNC_ACK_LOST');expect(calls).toBe(1);
});
it('records only explicit semantic rejects and propagates storage errors',async()=>{
 let archives=0;const archive=async()=>{archives++;return'proof'};
 await expect(runAndArchiveProbeReview(async()=>{throw Error('CRITIC_FACT_EVIDENCE_INVALID')},archive)).resolves.toEqual({status:'blocked',errorCode:'CRITIC_FACT_EVIDENCE_INVALID'});expect(archives).toBe(0);
 await expect(runAndArchiveProbeReview(async()=>{throw Error('STORE_READ_FAILED')},archive)).rejects.toThrow('STORE_READ_FAILED');
});
