import {expect,it} from 'vitest';
import {composeDockerArguments,composeStageKey,validateCaptionStyle} from '@/services/video/media/compose';

const style={fontSize:42,marginV:20,outline:2,primary:'#FFFFFF',outlineColor:'#112233'};
it('preserves a stereo master in final AAC instead of collapsing planned pan to mono',()=>{
 const args=composeDockerArguments('sha256:'+'a'.repeat(64),'1000:1000','b'.repeat(64),'/tmp/picture.mp4','/tmp/master.wav',null,'/tmp/output',null,false,2);
 expect(args[args.indexOf('-ac')+1]).toBe('2');
 expect(()=>composeDockerArguments('sha256:'+'a'.repeat(64),'1000:1000','b'.repeat(64),'/tmp/picture.mp4','/tmp/master.wav',null,'/tmp/output',null,false,3 as 2)).toThrow('COMPOSITION_INVALID');
});
it('composes video, audio and subtitles in a pinned no-network image with explicit style',()=>{
 const args=composeDockerArguments('sha256:'+'a'.repeat(64),'1000:1000','b'.repeat(64),'/tmp/picture.mp4','/tmp/track.wav','/tmp/captions.srt','/tmp/output',style,false);
 expect(args).toContain('--network');expect(args).toContain('none');expect(args).toContain('--read-only');expect(args).toContain('--cap-drop');
 expect(args.filter(value=>value.includes('readonly'))).toHaveLength(3);
 expect(args.join(' ')).toContain('subtitles=filename=/input/subtitles.srt');
 expect(args.join(' ')).toContain('-c:a aac');
 expect(args).toContain('acompressor=threshold=0.08:ratio=4:attack=2:release=100:detection=peak,loudnorm=I=-14:TP=-1.5:LRA=11');
 expect(composeDockerArguments('sha256:'+'a'.repeat(64),'1000:1000','b'.repeat(64),'/tmp/picture.mp4','/tmp/track.wav',null,'/tmp/output',null,true)).not.toContain('-af');
 expect(args.join(' ')).not.toMatch(/MODEL_API_KEY|VERCEL|BLOB_READ_WRITE_TOKEN/);
 expect(validateCaptionStyle(style)).toContain('OutlineColour=&H00332211&');
});
it('changes stage identity when approved content, sound, style or fence changes',()=>{
 const input={pictureSha256:'a'.repeat(64),trackSha256:'b'.repeat(64),trackSilent:false,srtSha256:'c'.repeat(64),style,runtimeDigest:'d'.repeat(64),spec:{width:320,height:180,durationSec:20,fps:24 as const,bundleHash:'e'.repeat(64),fence:1}};
 const key=composeStageKey(input);
 expect(composeStageKey({...input,trackSha256:'f'.repeat(64)})).not.toBe(key);
 expect(composeStageKey({...input,style:{...style,fontSize:43}})).not.toBe(key);
 expect(composeStageKey({...input,trackSilent:true})).not.toBe(key);
 expect(composeStageKey({...input,spec:{...input.spec,fence:2}})).not.toBe(key);
 expect(()=>composeDockerArguments('latest','1000:1000','b'.repeat(64),'/tmp/picture.mp4','/tmp/track.wav',null,'/tmp/output',null,true)).toThrow('COMPOSITION_INVALID');
 expect(()=>validateCaptionStyle({...style,primary:'red'})).toThrow('CAPTION_STYLE_INVALID');
});
