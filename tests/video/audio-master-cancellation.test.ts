import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {mkdtemp,mkdir,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname,join} from 'node:path';
const {execute}=vi.hoisted(()=>({execute:vi.fn()}));
vi.mock('@/services/video/media/owned-docker',()=>({runOwnedDocker:execute}));
vi.mock('node:child_process',()=>({spawn:()=>{throw Error('UNOWNED_EXECUTION')}}));
import {buildAudioMaster} from '@/services/video/audio/master';
import {AudioPlanSchema} from '@/contracts/video/audio-plan';
import {probeTrackWav,probeStereoTrackWav} from '@/services/video/audio/wav';
import {canonicalHash} from '@/services/video/domain/hash';
let root:string;
beforeEach(async()=>{root=await mkdtemp(join(tmpdir(),'vb-master-cancel-'));execute.mockReset()});afterEach(async()=>{await rm(root,{recursive:true,force:true})});
function silence(channels:1|2){
 const bytes=Buffer.alloc(44+960000*channels*4);bytes.write('RIFF');bytes.writeUInt32LE(bytes.length-8,4);bytes.write('WAVEfmt ',8);bytes.writeUInt32LE(16,16);bytes.writeUInt16LE(3,20);bytes.writeUInt16LE(channels,22);bytes.writeUInt32LE(48000,24);bytes.writeUInt32LE(48000*channels*4,28);bytes.writeUInt16LE(channels*4,32);bytes.writeUInt16LE(32,34);bytes.write('data',36);bytes.writeUInt32LE(bytes.length-44,40);return bytes;
}
async function fixture(){
 const runtimeDigest='a'.repeat(64),plan=AudioPlanSchema.parse({schemaVersion:1,briefVersion:1,styleSlug:'crayon-book',styleRulesHash:'b'.repeat(64),timingDraftHash:'c'.repeat(64),seed:1,sections:[{id:'all',startFrame:0,endFrame:480,bpm:120,beatsPerBar:4,beatUnit:4,barOffset:0}],cues:[],sources:[],music:[],foley:[],intentionalSilenceRanges:[],mix:{targetLufs:-14,toleranceLu:1,maxTruePeakDbtp:-1.2,voiceGainDb:0,duck:{thresholdDb:-24,ratio:4,attackMs:10,releaseMs:180}},reasoning:'Silent cancellation protocol fixture, not real music or QA.'});
 const voiceBytes=silence(1),stemBytes=silence(2),voicePath=join(root,'audio','fixture','track.wav'),musicPath=join(root,'sound','fixture','music.wav'),foleyPath=join(root,'sound','fixture','foley.wav');
 for(const [path,bytes] of [[voicePath,voiceBytes],[musicPath,stemBytes],[foleyPath,stemBytes]] as const){await mkdir(dirname(path),{recursive:true});await writeFile(path,bytes)}
 const narration={outputPath:voicePath,runtimeDigest,wav:probeTrackWav(voiceBytes,960000,true),kind:'narration_only' as const,qaStatus:'not_checked' as const},wav=probeStereoTrackWav(stemBytes,960000,true);
 const stems={stageKey:'d'.repeat(64),planSha256:canonicalHash(plan),runtimeDigest,toolSha256:'e'.repeat(64),music:{outputPath:musicPath,wav},foley:{outputPath:foleyPath,wav},qualityStatus:'listening_not_checked' as const};
 execute.mockImplementation(async(args:string[],_timeout:number,_image:string,active?:()=>Promise<void>)=>{
  await active?.();const mounts=args.filter(arg=>arg.startsWith('type=bind,src='));
  const mounted=(destination:string)=>mounts.find(arg=>arg.includes(',dst='+destination))!.split(',src=')[1].split(',dst=')[0];
  const document=JSON.parse(await readFile(mounted('/input/job.json'),'utf8')),output=mounted('/output');
  await writeFile(join(output,'master.wav'),stemBytes);await writeFile(join(output,'state.json'),JSON.stringify({schemaVersion:1,jobSha256:canonicalHash(document),outputSha256:wav.sha256}));return '';
 });
 const env={VIDEO_MEDIA_IMAGE_REF:'sha256:'+runtimeDigest,VIDEO_MEDIA_RUNTIME_DIGEST:runtimeDigest,VIDEO_MEDIA_TIMEOUT_SECONDS:'37'};
 return{plan,narration,stems,env};
}
it('rejects revoked authorization before starting any master producer',async()=>{
 const f=await fixture(),options={musicGainDb:-3,assertActive:async()=>{throw Error('RENDER_FENCED')}};
 await expect(buildAudioMaster(root,f.plan,f.narration,f.stems,20000,24,f.env,options)).rejects.toThrow('RENDER_FENCED');expect(execute).not.toHaveBeenCalled();
});
it.each([3,4])('does not return a mix after authorization is revoked at completion check %s',async revokeAt=>{
 const f=await fixture();let checks=0;const options={musicGainDb:-3,assertActive:async()=>{if(++checks>=revokeAt)throw Error('RENDER_FENCED')}};
 await expect(buildAudioMaster(root,f.plan,f.narration,f.stems,20000,24,f.env,options)).rejects.toThrow('RENDER_FENCED');expect(execute).toHaveBeenCalledTimes(1);
});
it('passes the pinned image, configured timeout and live authorization check to the owned producer',async()=>{
 const f=await fixture(),assertActive=vi.fn(async()=>{}),options={musicGainDb:-3,assertActive};
 const result=await buildAudioMaster(root,f.plan,f.narration,f.stems,20000,24,f.env,options);expect(result.musicGainDb).toBe(-3);
 expect(execute).toHaveBeenCalledWith(expect.arrayContaining(['--network','none','--read-only']),37000,f.env.VIDEO_MEDIA_IMAGE_REF,assertActive);expect(assertActive).toHaveBeenCalledTimes(4);
});
