import {describe,expect,it} from 'vitest';
import {initialUnderstanding} from '@/contracts/video/domain';
import {assertMvpProfile,deliveryGap,mvpProfileGap,soundEnabled} from '@/services/video/quality/delivery';
import {directorContext,directorProfile} from '@/mastra/video/director';
import {displayTitle} from '@/services/video/storage/project-store';
import {listStyles} from '@/services/video/styles/registry';
import {recommendStyles,styleCatalogEntries,styleFits} from '@/services/video/styles/recommendations';

function understanding(preferences:Partial<ReturnType<typeof initialUnderstanding>['preferences']>){const u=initialUnderstanding();u.subject='小猫的睡前故事';u.preferences={...u.preferences,...preferences};return u}
const silent={voiceMode:'none' as const,musicMode:'none' as const,captions:'none' as const};

describe('MVP delivery profile',()=>{
 it('accepts every style pack at 16:9 and 20–30 seconds',()=>{
  for(const style of listStyles()){
   const u=understanding({styleSlug:style.id,durationSec:25});
   expect(mvpProfileGap(u)).toBeUndefined();expect(()=>assertMvpProfile(u)).not.toThrow();
  }
 });
 it('explains each unsupported preference instead of failing later in the worker',()=>{
  for(const p of [{styleSlug:null},{styleSlug:'not-a-style',durationSec:20},{styleSlug:'watercolor',durationSec:45},{styleSlug:'ink-wash',durationSec:19},{styleSlug:'dataviz',durationSec:20,aspect:'9:16' as const}]){
   const u=understanding(p);expect(mvpProfileGap(u)).toBeTruthy();expect(()=>assertMvpProfile(u)).toThrow('MVP_PROFILE_UNSUPPORTED');
  }
  expect(mvpProfileGap(initialUnderstanding())).toBeDefined();
 });
});

describe('sound switch',()=>{
 it('is off by default in MVP and follows VIDEO_SOUND when set',()=>{
  expect(soundEnabled({VIDEO_DELIVERY_PROFILE:'mvp'})).toBe(false);
  expect(soundEnabled({VIDEO_DELIVERY_PROFILE:'mvp',VIDEO_SOUND:'on'})).toBe(true);
  expect(soundEnabled({})).toBe(true);
  expect(soundEnabled({VIDEO_SOUND:'off'})).toBe(false);
 });
 it('blocks a voiced brief only while sound is off, with a way forward',()=>{
  const voiced=understanding({styleSlug:'ink-wash',durationSec:30,voiceMode:'tts',musicMode:'composed'});
  expect(deliveryGap(voiced,{VIDEO_DELIVERY_PROFILE:'mvp'})).toMatchObject({code:'SOUND_DISABLED',message:expect.stringContaining('不要声音')});
  expect(deliveryGap(voiced,{VIDEO_DELIVERY_PROFILE:'mvp',VIDEO_SOUND:'on'})).toBeUndefined();
  expect(deliveryGap(understanding({styleSlug:'ink-wash',durationSec:30,...silent}),{VIDEO_DELIVERY_PROFILE:'mvp'})).toBeUndefined();
  expect(deliveryGap(understanding({styleSlug:'ink-wash',durationSec:45,...silent}),{VIDEO_DELIVERY_PROFILE:'mvp'})?.code).toBe('MVP_PROFILE_UNSUPPORTED');
 });
});

describe('style recommendation',()=>{
 it('describes every style pack',()=>{
  for(const style of listStyles()){expect(styleFits[style.id],style.id).toBeDefined();expect(styleFits[style.id].keywords.length).toBeGreaterThan(3)}
  expect(Object.keys(styleFits).sort()).toEqual(listStyles().map(s=>s.id).sort());
 });
 it('suggests styles that match what the person asked for',()=>{
  expect(recommendStyles('做一个年度数据报告，展示用户增长趋势').map(s=>s.id)).toContain('dataviz');
  expect(recommendStyles('中秋节给家人的祝福，想要团圆、月亮的感觉').map(s=>s.id)[0]).toBe('paper-lantern');
  expect(recommendStyles('给孩子讲一个睡前故事，主角是小猫').map(s=>s.id)[0]).toBe('crayon-book');
  expect(recommendStyles('介绍我们新发布的 SaaS 产品功能').map(s=>s.id)).toContain('dark-keynote');
  expect(recommendStyles('讲讲茶文化和古诗里的山水').map(s=>s.id)[0]).toBe('ink-wash');
  expect(recommendStyles('')).toEqual([]);
  expect(recommendStyles('给孩子讲睡前故事',3,['watercolor'])).toEqual([]);
 });
});

describe('director style catalog',()=>{
 const message={id:crypto.randomUUID(),role:'user' as const,text:'做个视频'};
 it('offers every style with what it is good for, in both profiles',()=>{
  for(const profile of ['full','mvp'] as const){
   const catalog=directorContext(initialUnderstanding(),[message],undefined,profile).styleCatalog;
   expect(catalog.map(s=>s.id)).toEqual(listStyles().map(s=>s.id));
   expect(catalog.every(s=>s.goodFor&&s.mood)).toBe(true);
  }
  expect(styleCatalogEntries(['ink-wash']).map(s=>s.id)).toEqual(['ink-wash']);
  expect(directorProfile({VIDEO_DELIVERY_PROFILE:'mvp'})).toBe('mvp');expect(directorProfile({})).toBe('full');
 });
});

describe('project display title',()=>{
 it('uses the understood subject while the stored title is still the placeholder',()=>{
  expect(displayTitle('新视频','')).toBe('新视频');
  expect(displayTitle('新视频','  小猫的\n睡前故事 ')).toBe('小猫的 睡前故事');
  expect(displayTitle('我起的名字','小猫')).toBe('我起的名字');
  expect(displayTitle('新视频','一'.repeat(40))).toBe('一'.repeat(24)+'…');
 });
});
