import {afterEach,beforeEach,expect,it} from 'vitest';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {LocalAssetBytes} from '@/services/video/assets/local-bytes';

let root:string;
beforeEach(async()=>{root=await mkdtemp(join(tmpdir(),'vb-upload-'))});
afterEach(async()=>{await rm(root,{recursive:true,force:true})});
const project='11111111-1111-4111-8111-111111111111',asset='22222222-2222-4222-8222-222222222222';
function request(bytes:Uint8Array){return new Request('http://localhost/upload',{method:'PUT',body:bytes as BodyInit,duplex:'half'} as RequestInit)}

it('writes actual Markdown bytes privately and replays identical upload without changing hash',async()=>{
 const store=new LocalAssetBytes(root),bytes=Buffer.from('# 资料\n开业：10月8日');
 const first=await store.put(project,asset,request(bytes),{declaredMime:'text/markdown',declaredBytes:bytes.length});
 const second=await store.put(project,asset,request(bytes),{declaredMime:'text/markdown',declaredBytes:bytes.length});
 expect(second).toEqual(first);expect((await readFile(first.path)).equals(bytes)).toBe(true);
 expect(first.sha256).toMatch(/^[a-f0-9]{64}$/);
});

it('rejects MIME mismatch, byte overflow and conflicting replay',async()=>{
 const store=new LocalAssetBytes(root),png=Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a,0,0]);
 await expect(store.put(project,asset,request(png),{declaredMime:'text/markdown',declaredBytes:png.length})).rejects.toThrow('ASSET_INVALID');
 await expect(store.put(project,asset,request(Buffer.alloc(20)),{declaredMime:'text/markdown',declaredBytes:10})).rejects.toThrow('ASSET_INVALID');
 const bytes=Buffer.from('first');await store.put(project,asset,request(bytes),{declaredMime:'text/markdown',declaredBytes:bytes.length});
 await expect(store.put(project,asset,request(Buffer.from('other')),{declaredMime:'text/markdown',declaredBytes:5})).rejects.toThrow('ASSET_HASH_CONFLICT');
});
