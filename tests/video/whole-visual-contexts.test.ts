import {describe,it,expect} from 'vitest';
import {wholeFilmVisualPlan} from '@/services/video/quality/whole-visual-plan';
import {prepareWholeVisualContexts} from '@/services/video/quality/whole-visual-contexts';
const plan=wholeFilmVisualPlan({fps:24,totalFrames:480,shots:[{id:'shot',startFrame:0,endFrame:480}],captions:[]});
const baseline={filmSha256:'a'.repeat(64),filmSpecSha256:'b'.repeat(64),styleSlug:'crayon-book',styleRulesHash:'c'.repeat(64),facts:[{id:'fact',text:'从播种到发芽'}]};
function batches(){return plan.rounds.flatMap(r=>r.batches.map(b=>({round:r.round,index:b.index,evidence:{schemaVersion:2 as const,extractor:'ffmpeg-select-v2' as const,filmSha256:baseline.filmSha256,runtimeDigest:'d'.repeat(64),stageKey:String(r.round).repeat(64),width:1920,height:1080,frames:b.frames.map(frame=>({id:'frame-'+frame,frame,sha256:'e'.repeat(64),bytes:100,filename:'frame-0001.png'}))}})))}
describe('whole visual preflight',()=>{
 it('rejects incomplete or swapped physical batches before any critic can start',()=>{
  const all=batches();expect(()=>prepareWholeVisualContexts(plan,baseline,all.slice(1),'d'.repeat(64))).toThrow('WHOLE_VISUAL_COVERAGE_MISSING');
  const swapped=batches();swapped[0].evidence.frames[0].frame=479;expect(()=>prepareWholeVisualContexts(plan,baseline,swapped,'d'.repeat(64))).toThrow('WHOLE_VISUAL_COVERAGE_MISSING');
 });
 it('binds every prepared context to exact facts, movie and runtime',()=>{
  const bad=batches();bad[bad.length-1].evidence.filmSha256='f'.repeat(64);expect(()=>prepareWholeVisualContexts(plan,baseline,bad,'d'.repeat(64))).toThrow('CRITIC_BASELINE_CHANGED');
  expect(()=>prepareWholeVisualContexts(plan,baseline,batches(),'f'.repeat(64))).toThrow('CRITIC_BASELINE_CHANGED');
  const ready=prepareWholeVisualContexts(plan,baseline,batches(),'d'.repeat(64));expect(ready).toHaveLength(batches().length);expect(ready.every(c=>c.facts[0].text==='从播种到发芽'&&c.filmSha256===baseline.filmSha256)).toBe(true);
 });
});
