import {expect,it} from 'vitest';
import {pictureSequenceDockerArguments,pictureSequenceStageKey,validatePictureSequence} from '@/services/video/media/picture-sequence';

const shots=[
 {shotId:'a',startFrame:0,endFrame:240,stageKey:'a'.repeat(64),sha256:'b'.repeat(64)},
 {shotId:'b',startFrame:240,endFrame:480,stageKey:'c'.repeat(64),sha256:'d'.repeat(64)},
];
it('T11 joins exactly the frozen frame-contiguous shot clips in an isolated runtime',()=>{
 const input={projectId:'p',revisionId:'r',shots,width:320,height:180,fps:24 as const,runtimeDigest:'e'.repeat(64),fence:0};
 expect(validatePictureSequence(input)).toBe(480);
 const key=pictureSequenceStageKey(input);
 expect(pictureSequenceStageKey({...input,shots:[{...shots[0],sha256:'f'.repeat(64)},shots[1]]})).not.toBe(key);
 expect(pictureSequenceStageKey({...input,fence:1})).not.toBe(key);
 const args=pictureSequenceDockerArguments('sha256:'+'e'.repeat(64),'1000:1000',key,'/tmp/output',shots.map(shot=>`/tmp/media/${shot.stageKey}/output/picture.mp4`),shots,24);
 expect(args.join(' ')).toContain('concat=n=2:v=1:a=0');
 expect(args.join(' ')).toContain('trim=start_frame=0:end_frame=240');
 expect(args).toContain('--network');expect(args).toContain('none');
 expect(args.filter(value=>value.includes('readonly'))).toHaveLength(2);
 expect(args.join(' ')).not.toMatch(/MODEL_API_KEY|VIDEO_SESSION_SIGNING_KEY/);
});
it('T11 rejects missing or overlapping shot frames',()=>{
 const input={projectId:'p',revisionId:'r',shots,width:320,height:180,fps:24 as const,runtimeDigest:'e'.repeat(64),fence:0};
 expect(()=>validatePictureSequence({...input,shots:[shots[0],{...shots[1],startFrame:239}]})).toThrow('PICTURE_SEQUENCE_INVALID');
 expect(()=>validatePictureSequence({...input,shots:[shots[0],{...shots[1],startFrame:241}]})).toThrow('PICTURE_SEQUENCE_INVALID');
 expect(()=>validatePictureSequence({...input,shots:[shots[1],shots[0]]})).toThrow('PICTURE_SEQUENCE_INVALID');
});
