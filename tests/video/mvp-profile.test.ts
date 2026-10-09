import {describe,expect,it} from 'vitest';
import {initialUnderstanding} from '@/contracts/video/domain';
import {assertMvpProfile,mvpProfileGap} from '@/services/video/quality/delivery';
import {directorContext,directorProfile} from '@/mastra/video/director';
import {displayTitle} from '@/services/video/storage/project-store';

function understanding(preferences:Partial<ReturnType<typeof initialUnderstanding>['preferences']>){const u=initialUnderstanding();u.subject='小猫的睡前故事';u.preferences={...u.preferences,...preferences};return u}

describe('MVP delivery profile',()=>{
 it('accepts exactly the profile the pipeline can deliver',()=>{
  const ok=understanding({styleSlug:'crayon-book',durationSec:20,aspect:'16:9',language:'zh-CN'});
  expect(mvpProfileGap(ok)).toBeUndefined();expect(()=>assertMvpProfile(ok)).not.toThrow();
  expect(mvpProfileGap(understanding({styleSlug:'crayon-book',durationSec:30,language:'en'}))).toBeUndefined();
 });
 it('explains each unsupported preference instead of failing later in the worker',()=>{
  for(const p of [{styleSlug:null},{styleSlug:'watercolor',durationSec:20},{styleSlug:'crayon-book',durationSec:45},{styleSlug:'crayon-book',durationSec:19},{styleSlug:'crayon-book',durationSec:20,aspect:'9:16' as const}]){
   const u=understanding(p);expect(mvpProfileGap(u)).toMatch(/当前版本/);expect(()=>assertMvpProfile(u)).toThrow('MVP_PROFILE_UNSUPPORTED');
  }
  // The initial default (45s, no style) is outside the MVP profile, so the director must set both.
  expect(mvpProfileGap(initialUnderstanding())).toBeDefined();
 });
});

describe('director style catalog',()=>{
 const message={id:crypto.randomUUID(),role:'user' as const,text:'做个视频'};
 it('offers every style in full mode and only deliverable styles in MVP mode',()=>{
  expect(directorContext(initialUnderstanding(),[message]).styleCatalog).toHaveLength(43);
  expect(directorContext(initialUnderstanding(),[message],undefined,'mvp').styleCatalog.map(s=>s.id)).toEqual(['crayon-book']);
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
