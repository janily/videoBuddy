import {it,expect} from 'vitest';
import {resolveMusicGain} from '@/services/video/revisions/music-gain';
it('T13 relative reductions accumulate from verified master gain and absolute requests remain exact',()=>{
 expect(resolveMusicGain(0,{field:'musicGainDb',value:-3,valueMode:'relative'})).toEqual({originalMusicGainDb:0,musicGainDb:-3,deltaDb:-3,scope:'entire_film'});
 expect(resolveMusicGain(-3,{field:'musicGainDb',value:-3,valueMode:'relative'}).musicGainDb).toBe(-6);
 expect(resolveMusicGain(-3,{field:'musicGainDb',value:0,valueMode:'absolute'}).musicGainDb).toBe(0);
 expect(resolveMusicGain(-3,{field:'musicGainDb',value:-3}).deltaDb).toBe(0);
});
it('T13 cannot clamp a reduction beyond the safe range or accept malformed/unknown baseline gain',()=>{
 expect(()=>resolveMusicGain(-6,{field:'musicGainDb',value:-3,valueMode:'relative'})).toThrow('CHANGE_PREVIEW_REQUIRED');
 for(const gain of [NaN,Infinity,-7,1])expect(()=>resolveMusicGain(gain,{field:'musicGainDb',value:-3})).toThrow('MUSIC_GAIN_BASELINE_INVALID');
 for(const op of [{field:'musicGainDb',value:0,valueMode:'relative'},{field:'musicGainDb',value:NaN},{field:'other',value:-3},{field:'musicGainDb',value:-3,sourceTimeMs:1000}])expect(()=>resolveMusicGain(0,op)).toThrow('CHANGE_PLAN_INVALID');
});
