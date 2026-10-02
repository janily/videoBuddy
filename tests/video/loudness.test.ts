import {expect,it} from 'vitest';
import {classifyLoudness,loudnessDockerArguments,parseLoudnessReport} from '@/services/video/audio/loudness';

it('measures the decoded final AAC audio in a pinned offline container',()=>{
 const args=loudnessDockerArguments('sha256:'+'a'.repeat(64),'1000:1000','/tmp/final.mp4');
 expect(args).toContain('--network');expect(args).toContain('none');expect(args).toContain('--read-only');
 expect(args).toContain('type=bind,src=/tmp/final.mp4,dst=/input/final.mp4,readonly');
 expect(args).toContain('loudnorm=I=-14:TP=-1.2:LRA=11:print_format=json');
 expect(()=>loudnessDockerArguments('latest','1000:1000','/tmp/final.mp4')).toThrow('LOUDNESS_JOB_INVALID');
});
it('blocks either loudness or true peak outside the final AAC profile',()=>{
 expect(classifyLoudness({integratedLufs:-14.43,truePeakDbtp:-1.37},false)).toBe('pass');
 expect(classifyLoudness({integratedLufs:-15.01,truePeakDbtp:-1.37},false)).toBe('fail');
 expect(classifyLoudness({integratedLufs:-14.43,truePeakDbtp:-1.19},false)).toBe('fail');
 expect(classifyLoudness({integratedLufs:-Infinity,truePeakDbtp:-Infinity},true)).toBe('not_applicable');
 expect(classifyLoudness({integratedLufs:-14.43,truePeakDbtp:-1.37},true)).toBe('fail');
});
it('parses measured loudness and rejects missing or forged reports',()=>{
 expect(parseLoudnessReport('ffmpeg log\n{"input_i":"-14.05","input_tp":"-1.33"}\n')).toEqual({integratedLufs:-14.05,truePeakDbtp:-1.33});
 expect(parseLoudnessReport('{"input_i":"-inf","input_tp":"-inf"}')).toEqual({integratedLufs:-Infinity,truePeakDbtp:-Infinity});
 expect(()=>parseLoudnessReport('{"output_i":"-14.00","input_tp":"-1.33"}')).toThrow('LOUDNESS_REPORT_INVALID');
 expect(()=>parseLoudnessReport('{"input_i":"nan","input_tp":"-1.33"}')).toThrow('LOUDNESS_REPORT_INVALID');
});
