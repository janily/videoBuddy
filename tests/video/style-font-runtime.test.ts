import {expect,it} from 'vitest';
import {readPinnedStyleFont} from '@/services/video/audio/style-font';
import type {runOwnedDocker} from '@/services/video/media/owned-docker';
const env={VIDEO_MEDIA_IMAGE_REF:'sha256:'+'a'.repeat(64),VIDEO_MEDIA_RUNTIME_DIGEST:'a'.repeat(64),VIDEO_MEDIA_TIMEOUT_SECONDS:'60'};
const actual={family:'Ma Shan Zheng',charset:'0041-005a 4e00-4e03',fontSha256:'6d2546bb189c732a8ca29af9e22457b152387d158aa459e4ac2ce1e51788b7fb',fontBytes:5857936,licenseSha256:'d7bdb1cee215b689e23c2f95672a6084c790542170648267a55114103d756a08',metadataSha256:'7e21912b6659b58694f0b999e69ad5a95da12fdc453565059727a2467e525f84'};
it('verifies exact installed font/license/metadata and actual glyphs in a pinned offline nonroot image',async()=>{
 let calls=0;
 const run:typeof runOwnedDocker=async(args,_timeout,image)=>{calls++;expect(image).toBe(env.VIDEO_MEDIA_IMAGE_REF);expect(args).toContain('--read-only');expect(args).toContain('--network');expect(args).toContain('none');expect(args).toContain('--user');expect(args.join(' ')).not.toMatch(/https:|MODEL_API_KEY/);return JSON.stringify(actual)};
 const font=await readPinnedStyleFont(env,'mashanzheng',{run});
 expect(calls).toBe(1);expect(font.family).toBe('Ma Shan Zheng');expect(font.glyphs.has('一')).toBe(true);expect(font.glyphs.has('水')).toBe(false);expect(font.fontSha256).toBe(actual.fontSha256);
 for(const altered of [{...actual,fontSha256:'b'.repeat(64)},{...actual,licenseSha256:'b'.repeat(64)},{...actual,metadataSha256:'b'.repeat(64)},{...actual,fontBytes:1},{...actual,family:'Noto Sans CJK SC'},{...actual,charset:''}])await expect(readPinnedStyleFont(env,'mashanzheng',{run:async()=>JSON.stringify(altered)})).rejects.toThrow('STYLE_FONT_RUNTIME_CHANGED');
});
it('rejects an unknown font or mutable media image before executing anything',async()=>{
 let calls=0;const run:typeof runOwnedDocker=async()=>{calls++;return JSON.stringify(actual)};
 await expect(readPinnedStyleFont(env,'user/font',{run})).rejects.toThrow('STYLE_FONT_UNSUPPORTED');
 await expect(readPinnedStyleFont({...env,VIDEO_MEDIA_IMAGE_REF:'latest'},'mashanzheng',{run})).rejects.toThrow('CAPABILITY_UNAVAILABLE');
 expect(calls).toBe(0);
});
