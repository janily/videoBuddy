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
it('verifies the clear handwriting face as a separate locked font without accepting the legacy font',async()=>{
 const long={family:'Long Cang',charset:'6599 79d1 7c73 79be',fontSha256:'e5bf2c3f24ef2327c6f136d8f73e2f9dfdf44896fdbeb35a9515f44777bb91bc',fontBytes:5162508,licenseSha256:'603546b7219a94bb59bf8294458194a5010119486354092b66a09a3fd61aeacc',metadataSha256:'c7d6c01a886b37dcef3c1e89796424f34240647fedac0d37108309c02fa8f3a3'};
 expect((await readPinnedStyleFont(env,'longcang',{run:async args=>{expect(args).toContain('/usr/local/share/fonts/videobuddy/LongCang-Regular.ttf');return JSON.stringify(long)}})).glyphs.has('料')).toBe(true);
 for(const value of [actual,{...long,fontSha256:'f'.repeat(64)},{...long,licenseSha256:'f'.repeat(64)},{...long,metadataSha256:'f'.repeat(64)}])await expect(readPinnedStyleFont(env,'longcang',{run:async()=>JSON.stringify(value)})).rejects.toThrow('STYLE_FONT_RUNTIME_CHANGED');
});
it('cold font verification consumes exact completed journal stdout with zero producer calls or store writes',async()=>{
 const {mkdtemp}=await import('node:fs/promises'),{tmpdir}=await import('node:os'),{join}=await import('node:path'),{randomUUID}=await import('node:crypto'),{FileStore}=await import('@/services/video/storage/file-store'),{dockerArgumentsHash}=await import('@/services/video/media/docker-journal'),{verifierStore}=await import('@/services/video/render/content-review');
 const root=await mkdtemp(join(tmpdir(),'vb-font-readonly-')),store=new FileStore(root),prefix=`projects/${randomUUID()}/operations/${randomUUID()}/media-effects`;let argumentsForProbe:string[]=[];
 await readPinnedStyleFont(env,'mashanzheng',{run:async args=>{argumentsForProbe=args;return JSON.stringify(actual)}});
 const argsSha256=dockerArgumentsHash(argumentsForProbe,env.VIDEO_MEDIA_IMAGE_REF),key=prefix+'/'+argsSha256,receipt={schemaVersion:1,invocation:randomUUID(),image:env.VIDEO_MEDIA_IMAGE_REF,argsSha256,state:'completed',output:JSON.stringify(actual)};await store.create(key,receipt);
 let calls=0;const result=await readPinnedStyleFont(env,'mashanzheng',{mustExist:true,journal:{store:verifierStore(store),prefix},run:async()=>{calls++;throw Error('UNEXPECTED_FONT_PRODUCER')}});
 expect(result.fontSha256).toBe(actual.fontSha256);expect(calls).toBe(0);expect((await store.readFresh(key)).value).toEqual(receipt);
 await expect(readPinnedStyleFont(env,'mashanzheng',{mustExist:true,journal:{store,prefix:`projects/${randomUUID()}/operations/${randomUUID()}/media-effects`},run:async()=>{calls++;throw Error('UNEXPECTED_FONT_PRODUCER')}})).rejects.toThrow();expect(calls).toBe(0);
});
