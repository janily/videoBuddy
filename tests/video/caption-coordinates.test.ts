import {expect,it} from 'vitest';
import {captionStyleForProfile} from '@/services/video/timeline/package';
import {composeDockerArguments,composeStageKey,validateCaptionStyle,type CaptionStyle} from '@/services/video/media/compose';

it.each([{width:1920,height:1080},{width:1080,height:1920}])('keeps full/preview/probe captions in the same logical composition %j',output=>{
 const full=captionStyleForProfile('full',output),preview=captionStyleForProfile('preview',output),probe=captionStyleForProfile('probe',output);
 expect(full).toEqual(preview);expect(probe).toEqual(full);
 expect(full).toMatchObject({playResX:output.width,playResY:output.height,fontSize:68,marginV:72});
 const args=composeDockerArguments('sha256:'+'a'.repeat(64),'1000:1000','b'.repeat(64),'/tmp/picture.mp4','/tmp/master.wav','/tmp/captions.srt','/tmp/output',preview,false);
 expect(args[args.indexOf('-vf')+1]).toContain(`PlayResX=${output.width},PlayResY=${output.height}`);
});
it('does not reinterpret frozen legacy captions or share their composition key',()=>{
 const legacy=captionStyleForProfile('preview',undefined,'v5.1-package-1');
 expect(legacy).toEqual({fontSize:54,marginV:48,outline:3,primary:'#FFFFFF',outlineColor:'#000000'});
 expect(validateCaptionStyle(legacy)).not.toContain('PlayRes');
 const updated=captionStyleForProfile('preview',{width:1920,height:1080});
 const input={pictureSha256:'a'.repeat(64),trackSha256:'b'.repeat(64),trackSilent:false,srtSha256:'c'.repeat(64),runtimeDigest:'d'.repeat(64),style:legacy,spec:{width:1280,height:720,durationSec:20,fps:24 as const,bundleHash:'e'.repeat(64),fence:0}};
 expect(composeStageKey({...input,style:updated})).not.toBe(composeStageKey(input));
 for(const style of [{...updated,playResY:undefined},{...updated,playResX:1921},{...updated,playResX:0},{...updated,playResY:5000}])expect(()=>validateCaptionStyle(style as CaptionStyle)).toThrow('CAPTION_STYLE_INVALID');
 expect(()=>captionStyleForProfile('preview',undefined)).toThrow('CAPTION_LAYOUT_REQUIRED');
});
