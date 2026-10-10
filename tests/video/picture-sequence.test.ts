import {afterEach,expect,it,vi} from 'vitest';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import type {RenderedVideo} from '@/services/video/media/runtime';
import type {LocalContext} from '@/services/video/media/local/renderer';
const {cached,commands}=vi.hoisted(()=>({cached:new Map<string,RenderedVideo>(),commands:[] as string[][]}));
vi.mock('@/services/video/media/local/cache',()=>({readVideoCache:async(_stage:string,key:string)=>cached.get(key)||null}));
vi.mock('@/services/video/media/local/ffmpeg',()=>({assertNotAborted:()=>{},runProcess:async(_binary:string,args:string[])=>{commands.push(args);const index=args.indexOf('-i');commands.push([(await readFile(args[index+1],'utf8'))]);throw Error('PROBE_BEFORE_ENCODING')}}));
import {assemble} from '@/services/video/media/local/assemble';
const roots:string[]=[];
afterEach(async()=>{cached.clear();commands.length=0;await Promise.all(roots.splice(0).map(root=>rm(root,{recursive:true,force:true})))});
async function fixture(){
 const root=await mkdtemp(join(tmpdir(),'vb-assembly-'));roots.push(root);const digest='a'.repeat(64),runtime={root,runtimeDigest:digest,ffmpeg:'ffmpeg',timeoutMs:1000} as LocalContext;
 const clips=['b','c'].map((hex,index)=>{const key=hex.repeat(64),clip:RenderedVideo={key,kind:'clip',runtimeDigest:digest,outputPath:join(root,'media',key,'clip.mp4'),manifestPath:join(root,'media',key,'manifest.json'),sha256:String(index).repeat(64),bytes:1000,width:320,height:180,fps:24,frameCount:24,durationSec:1,audio:false,videoCodec:'h264',pixelFormat:'yuv420p',colorSpace:'bt709',tags:{}};cached.set(key,clip);return clip});
 return{runtime,clips,input:{projectId:randomUUID(),clips,music:null,title:'Assembly contract'}};
}
it('assembles verified clips in frozen input order with stream copy and exact total duration',async()=>{
 const {runtime,input,clips}=await fixture();await expect(assemble(runtime,input)).rejects.toThrow('PROBE_BEFORE_ENCODING');
 expect(commands[1][0]).toBe(clips.map(clip=>`file '${clip.outputPath}'`).join('\n')+'\n');expect(commands[0][commands[0].indexOf('-c:v')+1]).toBe('copy');expect(commands[0][commands[0].indexOf('-t')+1]).toBe('2');
 commands.length=0;await expect(assemble(runtime,{...input,clips:[...clips].reverse()})).rejects.toThrow('PROBE_BEFORE_ENCODING');expect(commands[1][0]).toBe([...clips].reverse().map(clip=>`file '${clip.outputPath}'`).join('\n')+'\n');
});
it('rejects altered clip metadata, missing cache receipts and foreign paths before encoding',async()=>{
 const {runtime,input,clips}=await fixture();
 await expect(assemble(runtime,{...input,clips:[{...clips[0],sha256:'f'.repeat(64)}]})).rejects.toThrow('MEDIA_CACHE_INVALID');
 await expect(assemble(runtime,{...input,clips:[{...clips[0],outputPath:'/private/other.mp4'}]})).rejects.toThrow('MEDIA_PATH_INVALID');
 cached.delete(clips[1].key);await expect(assemble(runtime,input)).rejects.toThrow('MEDIA_CACHE_INVALID');expect(commands).toEqual([]);
});
it('rejects incompatible frame rates, dimensions and runtime versions before encoding',async()=>{
 const {runtime,input,clips}=await fixture();
 for(const patch of [{fps:30},{width:640},{runtimeDigest:'d'.repeat(64)},{audio:true}])await expect(assemble(runtime,{...input,clips:[clips[0],{...clips[1],...patch}]})).rejects.toThrow('ASSEMBLY_CLIP_MISMATCH');
 expect(commands).toEqual([]);
});
