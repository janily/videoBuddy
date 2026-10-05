import {expect,it} from 'vitest';
import {mvpFilmVisualPlan,wholeFilmVisualPlan} from '@/services/video/quality/whole-visual-plan';
const clock={fps:24 as const,totalFrames:480,shots:[{id:'a',startFrame:0,endFrame:240},{id:'b',startFrame:240,endFrame:480}],captions:[{startFrame:20,stableReadableStartFrame:29,endFrame:200},{startFrame:260,stableReadableStartFrame:269,endFrame:440}]};
it('samples every MVP shot and readable caption in two rounds without claiming continuous action coverage',()=>{
 const full=wholeFilmVisualPlan(clock),mvp=mvpFilmVisualPlan(clock);expect(full.schemaVersion).toBe(1);expect(mvp).toMatchObject({schemaVersion:2,profile:'mvp',actionCoverage:'sampled_shots'});expect(mvp.rounds).toHaveLength(2);expect(mvp.rounds.flatMap(r=>r.batches).length).toBeLessThan(full.rounds.flatMap(r=>r.batches).length);
 for(const round of mvp.rounds){for(const shot of clock.shots)expect(round.frames.some(f=>f>=shot.startFrame&&f<shot.endFrame)).toBe(true);for(const cue of clock.captions)expect(round.frames.some(f=>f>=cue.stableReadableStartFrame&&f<cue.endFrame)).toBe(true);expect(round.batches.every(b=>b.frames.length<=8)).toBe(true)}
});
it('rejects invalid clocks and incomplete caption ranges instead of silently dropping them',()=>{expect(()=>mvpFilmVisualPlan({...clock,totalFrames:24})).toThrow();expect(()=>mvpFilmVisualPlan({...clock,captions:[{startFrame:1,endFrame:2,stableReadableStartFrame:3}]})).toThrow()});
it('uses two small real-image batches while covering every shot and readable caption',()=>{
 const plan=mvpFilmVisualPlan(clock,'caption_shot_v2');expect(plan.schemaVersion).toBe(3);
 for(const round of plan.rounds){
  expect(round.batches).toHaveLength(1);expect(round.frames).toHaveLength(2);
  for(const shot of clock.shots)expect(round.frames.some(f=>f>=shot.startFrame&&f<shot.endFrame)).toBe(true);
  for(const cue of clock.captions)expect(round.frames.some(f=>f>=cue.stableReadableStartFrame&&f<cue.endFrame)).toBe(true);
  expect(round.batches.every(b=>b.frames.length<=4)).toBe(true);
 }
 expect(plan.rounds[0].frames).not.toEqual(plan.rounds[1].frames);
 expect(mvpFilmVisualPlan(clock).schemaVersion).toBe(2);
});
it('includes uncaptained shots and shards many captions instead of dropping evidence',()=>{
 const many={...clock,shots:[{id:'a',startFrame:0,endFrame:40},{id:'b',startFrame:40,endFrame:480}],captions:Array.from({length:8},(_,i)=>({startFrame:50+i*50,stableReadableStartFrame:55+i*50,endFrame:90+i*50}))};
 const plan=mvpFilmVisualPlan(many,'caption_shot_v2');
 for(const round of plan.rounds){expect(round.frames).toHaveLength(9);expect(round.batches.every(b=>b.frames.length<=4)).toBe(true);expect(round.frames.some(f=>f<40)).toBe(true);for(const c of many.captions)expect(round.frames.some(f=>f>=c.stableReadableStartFrame&&f<c.endFrame)).toBe(true)}
});
