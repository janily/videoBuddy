import {expect,it} from 'vitest';
import {activeVoiceWindows,assertTranscriptCoverage,audioChunkRanges,audioExtractionWindow,audioExtractArguments,audioProbeArguments} from '@/services/video/assets/audio-executor';
import {applyUnderstandingPatch} from '@/mastra/video/director';
import {initialUnderstanding} from '@/contracts/video/domain';

it('probes and decodes uploaded audio only inside the pinned no-network media image',()=>{
 const image='sha256:'+'a'.repeat(64),probe=audioProbeArguments(image,'1000:1000','/tmp/source.bin'),extract=audioExtractArguments(image,'1000:1000','/tmp/source.bin','/tmp/output',25000,25000,1);
 for(const args of [probe,extract]){expect(args).toContain('--network');expect(args).toContain('none');expect(args).toContain('--read-only');expect(args).toContain('type=bind,src=/tmp/source.bin,dst=/input/source,readonly')}
 expect(extract).toContain('type=bind,src=/tmp/output,dst=/output');expect(extract.join(' ')).toContain('-ss 25 -t 25');expect(extract.join(' ')).toContain('-ar 24000 -ac 1 -c:a pcm_f32le');
 expect(()=>audioProbeArguments('latest','1000:1000','/tmp/source.bin')).toThrow('AUDIO_SOURCE_INVALID');
});
it('refuses to publish a transcript that misses sustained audible speech',()=>{
 const bytes=Buffer.alloc(44+24000*4);bytes.write('RIFF',0);bytes.writeUInt32LE(bytes.length-8,4);bytes.write('WAVEfmt ',8);bytes.writeUInt32LE(16,16);bytes.writeUInt16LE(3,20);bytes.writeUInt16LE(1,22);bytes.writeUInt32LE(24000,24);bytes.writeUInt32LE(96000,28);bytes.writeUInt16LE(4,32);bytes.writeUInt16LE(32,34);bytes.write('data',36);bytes.writeUInt32LE(24000*4,40);
 for(let sample=2400;sample<12000;sample++)bytes.writeFloatLE(0.1,44+sample*4);
 const windows=activeVoiceWindows(bytes,1000,1000,2000);
 expect(windows).toHaveLength(4);expect(windows[0]).toEqual({startMs:1100,endMs:1200});
 expect(()=>assertTranscriptCoverage(windows,[{startMs:1000,endMs:2000}])).not.toThrow();
 expect(()=>assertTranscriptCoverage(windows,[])).not.toThrow();
 const missed=Array.from({length:12},(_,index)=>({startMs:index*100,endMs:index*100+100}));
 expect(()=>assertTranscriptCoverage(missed,[])).toThrow('AUDIO_TRANSCRIPT_INCOMPLETE');
});
it('splits at most 120 seconds into independent speech windows without tiny final chunks',()=>{
 expect(audioChunkRanges(52000)).toEqual([{index:0,startMs:0,lengthMs:17334},{index:1,startMs:17334,lengthMs:17334},{index:2,startMs:34668,lengthMs:17332}]);
 expect(audioExtractionWindow(audioChunkRanges(52000)[1],52000)).toEqual({startMs:15334,lengthMs:21334});
 expect(audioChunkRanges(120000)).toHaveLength(5);
 expect(()=>audioChunkRanges(120001)).toThrow('AUDIO_DURATION_UNSUPPORTED');
});
it('allows only an excerpt at the actual audio transcript time interval as a fact source',()=>{
 const messageId='10000000-0000-4000-8000-000000000001',assetId='30000000-0000-4000-8000-000000000003';
 const message={id:messageId,role:'user' as const,text:'',attachments:[{assetId,filename:'voice.wav',mime:'audio/wav',sha256:'a'.repeat(64),text:'[1000-3000ms] 上海的活动10月8日开始',segments:[{startMs:1000,endMs:3000,text:'上海的活动10月8日开始'}]}]};
 const fact={id:'date',text:'活动10月8日开始',sourceRefs:[{type:'uploaded_material',id:assetId,locator:'time:1000-3000',excerpt:'10月8日开始'}],status:'provided',mustInclude:false,critical:false};
 const patch={baseBriefVersion:0,operations:[{op:'add_fact',fact,sourceMessageIds:[messageId]}]};
 expect(applyUnderstandingPatch(initialUnderstanding(),patch,[message]).facts).toHaveLength(1);
 expect(()=>applyUnderstandingPatch(initialUnderstanding(),{...patch,operations:[{...patch.operations[0],fact:{...fact,sourceRefs:[{...fact.sourceRefs[0],locator:'time:3000-5000'}]}}]},[message])).toThrow('SOURCE_INVALID');
 expect(()=>applyUnderstandingPatch(initialUnderstanding(),{...patch,operations:[{...patch.operations[0],fact:{...fact,sourceRefs:[{...fact.sourceRefs[0],excerpt:'10月9日开始'}]}}]},[message])).toThrow('SOURCE_INVALID');
});
