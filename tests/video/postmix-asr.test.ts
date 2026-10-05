import {createHash} from 'node:crypto';
import {postMixExtractionKey} from '@/services/video/audio/postmix-extraction';
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

it('averages stereo channels without adding downmix gain and keeps historical extraction arguments',()=>{
 const old=postMixDockerArguments(image,'1000:1000','/tmp/final.mp4','/tmp/output',0,3900);
 const average=postMixDockerArguments(image,'1000:1000','/tmp/final.mp4','/tmp/output',0,3900,'stereo_average');
 expect(average[average.indexOf('-af')+1]).toBe('pan=mono|c0=0.5*c0+0.5*c1');
 expect(old).not.toContain('-af');
 expect(average.slice(-5)).toEqual(old.slice(-5));
});

it('preserves the original extraction key and separates stereo-average cache identity',()=>{
 const window={startMs:1000,lengthMs:4500,mediaRuntimeDigest:'b'.repeat(64)},filmSha='c'.repeat(64),legacy=createHash('sha256').update(JSON.stringify([filmSha,'line_1','zh-CN',1000,4500,window.mediaRuntimeDigest,'postmix-v1'])).digest('hex');
 expect(postMixExtractionKey(filmSha,'line_1','zh-CN',window)).toBe(legacy);
 expect(postMixExtractionKey(filmSha,'line_1','zh-CN',{...window,downmix:'stereo_average'})).not.toBe(legacy);
});

it('uses stereo averaging for new policy4 jobs while retaining the protocol of successful saved stages',async()=>{
 const {selectPostMixDownmix}=await import('@/services/video/audio/postmix-extraction');
 expect(selectPostMixDownmix('v5.1-package-4-clear-book-captions',2)).toBe('stereo_average');
 expect(selectPostMixDownmix('v5.1-package-4-clear-book-captions',2,{})).toBeUndefined();
 expect(selectPostMixDownmix('v5.1-package-4-clear-book-captions',2,{postMixDownmix:'stereo_average'})).toBe('stereo_average');
 expect(selectPostMixDownmix('v5.1-package-3-book-captions',2)).toBeUndefined();
 expect(()=>selectPostMixDownmix('v5.1-package-3-book-captions',2,{postMixDownmix:'stereo_average'})).toThrow('POSTMIX_POLICY_CHANGED');
});
