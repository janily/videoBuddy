import {afterEach,expect,it,vi} from 'vitest';
import {createHash,randomUUID} from 'node:crypto';
import {mkdir,mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const {producer}=vi.hoisted(()=>({producer:vi.fn(async()=>{throw Error('UNEXPECTED_ASR_PRODUCER')})}));
vi.mock('@/services/video/media/owned-docker',()=>({runOwnedDocker:producer}));
import {FileStore} from '@/services/video/storage/file-store';
import {reserveDockerInvocation,finishDockerInvocation} from '@/services/video/media/docker-journal';
import {asrConfiguration,asrDockerArguments,transcribeAudio} from '@/services/video/audio/asr';
import {inspectVoiceWav} from '@/services/video/audio/wav';
let root:string;
afterEach(async()=>{producer.mockClear();if(root)await rm(root,{recursive:true,force:true})});
async function fixture(){
 root=await mkdtemp(join(tmpdir(),'vb-asr-cache-'));
 // Valid synthetic PCM checks cache/hash protocol, not speech recognition QA.
 const pcm=Buffer.alloc(44+24000*4);pcm.write('RIFF');pcm.writeUInt32LE(pcm.length-8,4);pcm.write('WAVEfmt ',8);pcm.writeUInt32LE(16,16);pcm.writeUInt16LE(3,20);pcm.writeUInt16LE(1,22);pcm.writeUInt32LE(24000,24);pcm.writeUInt32LE(96000,28);pcm.writeUInt16LE(4,32);pcm.writeUInt16LE(32,34);pcm.write('data',36);pcm.writeUInt32LE(96000,40);for(let index=0;index<24000;index++)pcm.writeFloatLE(Math.sin(index/20)*0.1,44+index*4);
 const voiceDir=join(root,'voice','fixture');await mkdir(voiceDir,{recursive:true});const outputPath=join(voiceDir,'voice.wav');await writeFile(outputPath,pcm);const wav=await inspectVoiceWav(outputPath);
 const digest='a'.repeat(64),env={VIDEO_ASR_IMAGE_REF:'sha256:'+digest,VIDEO_ASR_RUNTIME_DIGEST:digest},config=asrConfiguration(env);
 const stageKey=createHash('sha256').update(JSON.stringify(['en',wav.sha256,digest,'faster-whisper-small'])).digest('hex'),dir=join(root,'asr',stageKey);await mkdir(dir,{recursive:true});const jobPath=join(dir,'job.json');await writeFile(jobPath,JSON.stringify({language:'en'}));
 const raw=JSON.stringify({language:'en',model:'Systran/faster-whisper-small',segments:[{text:'Hello',startMs:0,endMs:500,words:[{text:'Hello',startMs:0,endMs:500,probability:0.9}]}]});await writeFile(join(dir,'transcript.json'),raw);
 const journal={store:new FileStore(root),prefix:`projects/${randomUUID()}/operations/${randomUUID()}/media-effects`},args=asrDockerArguments(config,jobPath,outputPath),voice={language:'en' as const,outputPath,wav};
 const run=()=>transcribeAudio(root,voice,'voice',env,{mustExist:true,journal:{...journal,store:new FileStore(root)}});
 return{journal,args,config,raw,run};
}
it.each(['started','unknown','stopped'] as const)('rejects a schema-valid transcript cache with a %s producer',async state=>{
 const f=await fixture(),record=await reserveDockerInvocation(f.journal,f.args,f.config.image);if(state!=='started')await finishDockerInvocation(f.journal,record,state);
 await expect(f.run()).rejects.toThrow(state==='stopped'?'MEDIA_EXECUTION_INTERRUPTED':'MEDIA_STOP_UNKNOWN');expect(producer).not.toHaveBeenCalled();
});
it('rejects a schema-valid cache that differs from fixed completed stdout',async()=>{
 const f=await fixture(),record=await reserveDockerInvocation(f.journal,f.args,f.config.image);await finishDockerInvocation(f.journal,record,'completed',f.raw.replaceAll('Hello','Goodbye'));
 await expect(f.run()).rejects.toThrow('ASR_STAGE_UNKNOWN');expect(producer).not.toHaveBeenCalled();
});
it('reads unchanged historical and completed transcripts without a producer',async()=>{
 const f=await fixture();expect((await f.run()).recognizedText).toBe('Hello');const record=await reserveDockerInvocation(f.journal,f.args,f.config.image);await finishDockerInvocation(f.journal,record,'completed',f.raw);
 expect((await f.run()).recognizedText).toBe('Hello');expect(producer).not.toHaveBeenCalled();
});
