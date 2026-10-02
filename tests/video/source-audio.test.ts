import {expect,it} from 'vitest';
import {audioExtractArguments,audioProbeArguments} from '@/services/video/assets/audio-executor';
import {applyUnderstandingPatch} from '@/mastra/video/director';
import {initialUnderstanding} from '@/contracts/video/domain';

it('probes and decodes uploaded audio only inside the pinned no-network media image',()=>{
 const image='sha256:'+'a'.repeat(64),probe=audioProbeArguments(image,'1000:1000','/tmp/source.bin'),extract=audioExtractArguments(image,'1000:1000','/tmp/source.bin','/tmp/output');
 for(const args of [probe,extract]){expect(args).toContain('--network');expect(args).toContain('none');expect(args).toContain('--read-only');expect(args).toContain('type=bind,src=/tmp/source.bin,dst=/input/source,readonly')}
 expect(extract).toContain('type=bind,src=/tmp/output,dst=/output');expect(extract.join(' ')).toContain('-ar 24000 -ac 1 -c:a pcm_f32le');
 expect(()=>audioProbeArguments('latest','1000:1000','/tmp/source.bin')).toThrow('AUDIO_SOURCE_INVALID');
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
