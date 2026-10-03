import {expect,it} from 'vitest';
import {postMixDockerArguments,postMixSilenceDockerArguments} from '@/services/video/audio/postmix-asr';

const image='sha256:'+'a'.repeat(64);
it('extracts only the selected final-film audio window in a restricted pinned container',()=>{
 const args=postMixDockerArguments(image,'1000:1000','/tmp/final.mp4','/tmp/output',1000,4500);
 expect(args).toContain('--network');expect(args).toContain('none');expect(args).toContain('--read-only');
 expect(args).toContain('type=bind,src=/tmp/final.mp4,dst=/input/final.mp4,readonly');
 expect(args.slice(-14)).toEqual(['-ss','1','-t','4.5','-map','0:a:0','-vn','-ar','24000','-ac','1','-c:a','pcm_f32le','/output/line.wav']);
 expect(()=>postMixDockerArguments('latest','1000:1000','/tmp/final.mp4','/tmp/output',1000,4500)).toThrow('POSTMIX_JOB_INVALID');
 expect(()=>postMixDockerArguments(image,'1000:1000','/tmp/final.mp4','/tmp/output',-1,4500)).toThrow('POSTMIX_JOB_INVALID');
});
it('accepts sample-accurate voice durations and rounds the extraction window outward',()=>{
 const args=postMixDockerArguments(image,'1000:1000','/tmp/final.mp4','/tmp/output',1000,1300.0416666666665);
 expect(args[args.indexOf('-t')+1]).toBe('1.301');
});
it('measures the entire final-film audio for intentional silence',()=>{
 const args=postMixSilenceDockerArguments(image,'1000:1000','/tmp/final.mp4','/tmp/output');
 expect(args).toContain('type=bind,src=/tmp/final.mp4,dst=/input/final.mp4,readonly');
 expect(args.slice(-10)).toEqual(['-map','0:a:0','-vn','-ar','48000','-ac','1','-c:a','pcm_f32le','/output/track.wav']);
 expect(args).not.toContain('-t');
 expect(args).not.toContain('-ss');
});
