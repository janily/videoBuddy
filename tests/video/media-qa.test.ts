import {expect,it} from 'vitest';
import {validateVideoProbe} from '@/services/video/media/technical-qa';

const expected={width:320,height:180,durationSec:1,fps:24,audio:false};
const valid={streams:[{codec_type:'video',codec_name:'h264',width:320,height:180,avg_frame_rate:'24/1'}],format:{duration:'1.000000'}};
it('accepts a decoded video only when its actual metadata matches the render contract',()=>{
 expect(validateVideoProbe(valid,expected)).toMatchObject({width:320,height:180,durationSec:1,fps:24});
 expect(()=>validateVideoProbe({...valid,streams:[{...valid.streams[0],height:181}]},expected)).toThrow('QA_FAILED');
 expect(()=>validateVideoProbe({...valid,format:{duration:'0.500000'}},expected)).toThrow('QA_FAILED');
 expect(()=>validateVideoProbe({...valid,streams:[valid.streams[0],{codec_type:'audio',codec_name:'aac'}]},expected)).toThrow('QA_FAILED');
});
