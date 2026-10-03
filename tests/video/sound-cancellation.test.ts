import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const {execute}=vi.hoisted(()=>({execute:vi.fn()}));
vi.mock('@/services/video/media/owned-docker',()=>({runOwnedDocker:execute}));
vi.mock('node:child_process',()=>({spawn:()=>{throw Error('UNOWNED_EXECUTION')}}));
import {buildSoundStems} from '@/services/video/audio/sound';
import {AudioPlanSchema} from '@/contracts/video/audio-plan';
import {probeStereoTrackWav} from '@/services/video/audio/wav';
import {canonicalHash} from '@/services/video/domain/hash';
let root:string;
const plan=AudioPlanSchema.parse({schemaVersion:1,briefVersion:1,styleSlug:'crayon-book',styleRulesHash:'b'.repeat(64),timingDraftHash:'c'.repeat(64),seed:1,sections:[{id:'all',startFrame:0,endFrame:480,bpm:120,beatsPerBar:4,beatUnit:4,barOffset:0}],cues:[],sources:[],music:[],foley:[],intentionalSilenceRanges:[],mix:{targetLufs:-14,toleranceLu:1,maxTruePeakDbtp:-1.2,voiceGainDb:0,duck:{thresholdDb:-24,ratio:4,attackMs:10,releaseMs:180}},reasoning:'Silent cancellation protocol fixture, not authored media or QA.'});
const env={VIDEO_MEDIA_IMAGE_REF:'sha256:'+'a'.repeat(64),VIDEO_MEDIA_RUNTIME_DIGEST:'a'.repeat(64),VIDEO_MEDIA_TIMEOUT_SECONDS:'37'};
beforeEach(async()=>{root=await mkdtemp(join(tmpdir(),'vb-sound-cancel-'));execute.mockReset();execute.mockImplementation(async(args:string[],_timeout:number,_image:string,active?:()=>Promise<void>)=>{
 await active?.();const mounts=args.filter(arg=>arg.startsWith('type=bind,src=')),mounted=(destination:string)=>mounts.find(arg=>arg.includes(',dst='+destination))!.split(',src=')[1].split(',dst=')[0];
 const job=JSON.parse(await readFile(mounted('/input/job.json'),'utf8')),bytes=Buffer.alloc(44+960000*8);bytes.write('RIFF');bytes.writeUInt32LE(bytes.length-8,4);bytes.write('WAVEfmt ',8);bytes.writeUInt32LE(16,16);bytes.writeUInt16LE(3,20);bytes.writeUInt16LE(2,22);bytes.writeUInt32LE(48000,24);bytes.writeUInt32LE(48000*8,28);bytes.writeUInt16LE(8,32);bytes.writeUInt16LE(32,34);bytes.write('data',36);bytes.writeUInt32LE(bytes.length-44,40);
 const wav=probeStereoTrackWav(bytes,960000,true),output=mounted('/output');await writeFile(join(output,'music.wav'),bytes);await writeFile(join(output,'foley.wav'),bytes);await writeFile(join(output,'state.json'),JSON.stringify({schemaVersion:1,jobSha256:canonicalHash(job),outputs:{music:wav.sha256,foley:wav.sha256}}));return '';
})});
afterEach(async()=>{await rm(root,{recursive:true,force:true})});
it('does not invoke sound synthesis after authorization has been revoked',async()=>{
 const options={assertActive:async()=>{throw Error('PREVIEW_STALE')}};
 await expect(buildSoundStems(root,plan,20000,24,env,options)).rejects.toThrow('PREVIEW_STALE');expect(execute).not.toHaveBeenCalled();
});
it.each([3,4])('does not return stems after completion authorization check %s fails',async revokeAt=>{
 let checks=0;const options={assertActive:async()=>{if(++checks>=revokeAt)throw Error('PREVIEW_STALE')}};
 await expect(buildSoundStems(root,plan,20000,24,env,options)).rejects.toThrow('PREVIEW_STALE');expect(execute).toHaveBeenCalledTimes(1);
});
it('uses the pinned owned producer and configured timeout without changing the sound job hash',async()=>{
 const assertActive=vi.fn(async()=>{}),result=await buildSoundStems(root,plan,20000,24,env,{assertActive});
 expect(result.planSha256).toBe(canonicalHash(plan));expect(result.music.wav.silence).toBe(true);
 expect(execute).toHaveBeenCalledWith(expect.arrayContaining(['--network','none','--read-only']),37000,env.VIDEO_MEDIA_IMAGE_REF,assertActive);expect(assertActive).toHaveBeenCalledTimes(4);
});
