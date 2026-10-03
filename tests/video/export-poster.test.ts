import {describe,it,expect} from 'vitest';
import {posterFrame} from '@/services/video/exports/poster';
describe('poster from the published full film',()=>{
 it('selects the middle of the first shot, preserving full-film frame identity',()=>{
  expect(posterFrame({fps:24,totalFrames:480,shots:[{startFrame:0,endFrame:96},{startFrame:96,endFrame:480}]})).toBe(47);
  expect(posterFrame({fps:30,totalFrames:1,shots:[{startFrame:0,endFrame:1}]})).toBe(0);
 });
 it('rejects gaps, illegal intervals, unsupported clocks and incomplete coverage',()=>{
  for(const timeline of [{fps:25,totalFrames:480,shots:[{startFrame:0,endFrame:480}]},{fps:24,totalFrames:480,shots:[{startFrame:1,endFrame:480}]},{fps:24,totalFrames:480,shots:[{startFrame:0,endFrame:0}]},{fps:24,totalFrames:480,shots:[{startFrame:0,endFrame:96},{startFrame:100,endFrame:480}]}])expect(()=>posterFrame(timeline)).toThrow('EXPORT_POSTER_INVALID');
 });
});
