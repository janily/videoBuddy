import {expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import {mkdtemp,mkdir,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {initialUnderstanding} from '@/contracts/video/domain';
import type {ProjectControl} from '@/contracts/video/project';
import {probeVoiceWav} from '@/services/video/audio/wav';
import {StoreMissing,updateJson} from '@/services/video/storage/atomic-store';
import {FileStore} from '@/services/video/storage/file-store';
import {ProjectStore} from '@/services/video/storage/project-store';
import {getStyle} from '@/services/video/styles/registry';
import {prepareTreatmentStage} from '@/services/video/preview/treatment-stage';
import {prepareVoiceStage} from '@/services/video/preview/voice-stage';

function wav(){
 const data=Buffer.alloc(24000*4);
 for(let index=0;index<24000;index++)data.writeFloatLE(Math.sin(index*0.1)*0.1,index*4);
 const result=Buffer.alloc(44+data.length);result.write('RIFF',0);result.writeUInt32LE(result.length-8,4);result.write('WAVEfmt ',8);
 result.writeUInt32LE(16,16);result.writeUInt16LE(3,20);result.writeUInt16LE(1,22);result.writeUInt32LE(24000,24);result.writeUInt32LE(96000,28);result.writeUInt16LE(4,32);result.writeUInt16LE(32,34);result.write('data',36);result.writeUInt32LE(data.length,40);data.copy(result,44);
 return result;
}

it('T10 persists real voice bytes and verified ASR timings for a frozen treatment, then detects tampering',async()=>{
 const root=await mkdtemp(join(tmpdir(),'vb-voice-stage-'));
 try{
  const projects=new ProjectStore(new FileStore(root)),created=await projects.create('owner',{schemaVersion:5,clientCommandId:randomUUID(),clientCreateId:randomUUID()});
  const projectId=created.projectId,revisionId=randomUUID(),operationId=randomUUID(),style=getStyle('crayon-book'),base=initialUnderstanding();
  const understanding={...base,briefVersion:1,subject:'活动预告',preferences:{...base.preferences,durationSec:20,styleSlug:style.slug,voiceMode:'tts' as const}};
  const understandingRef=await projects.index.immutable(`projects/${projectId}/understanding/1`,understanding);
  await updateJson(projects.store,`projects/${projectId}/control`,(c:ProjectControl)=>({...c,briefVersion:1,understandingRef,phase:'preparing_preview' as const,activeProduction:operationId}));
  const plan={schemaVersion:1,briefVersion:1,styleSlug:style.slug,styleRulesHash:style.rulesHash,durationSec:20,aspect:'16:9',fps:24,summary:'活动预告',options:[{id:'a',concept:'绘图',visualApproach:'蜡笔',soundApproach:'鼓点',tradeoff:'动画多'},{id:'b',concept:'纸页',visualApproach:'翻页',soundApproach:'纸声',tradeoff:'人物少'},{id:'c',concept:'角色',visualApproach:'走路',soundApproach:'脚步',tradeoff:'造型复杂'}],selectedOptionId:'a',selectionReason:'信息清晰',shots:[{id:'shot',startFrame:0,endFrame:480,visualIntent:'活动日期',scriptLine:'欢迎参加。',factIds:[]}],script:['欢迎参加。']};
  const treatmentRef=await prepareTreatmentStage(projects,projectId,revisionId,operationId,0,{decide:async()=>plan,limits:{projectCalls:5,projectInputTokens:200000,projectOutputTokens:20000,dailyCalls:10}});
  const voicePath=join(root,'voice','fixture','narration.wav');let generated=0,recognized=0;
  const options={root,generate:async(_root:string,job:{lineId:string;language:'zh-CN'|'en';text:string})=>{
   generated++;await mkdir(join(root,'voice','fixture'),{recursive:true});const bytes=wav();await writeFile(voicePath,bytes);
   return{lineId:job.lineId,language:job.language,voice:'zf_001' as const,provider:'kokoro-js' as const,model:'test-runtime',modelLicense:'Apache-2.0' as const,runtimeDigest:'a'.repeat(64),outputPath:voicePath,wav:probeVoiceWav(bytes)};
  },recognize:async(_root:string,voice:{wav:{sha256:string}})=>{
   recognized++;return{language:'zh-CN' as const,model:'Systran/faster-whisper-small' as const,segments:[{text:'欢迎参加。',startMs:0,endMs:700,words:[{text:'欢迎参加',startMs:0,endMs:700,probability:0.9}]}],voiceSha256:voice.wav.sha256,runtimeDigest:'b'.repeat(64),recognizedText:'欢迎参加。'};
  }};
  const first=await prepareVoiceStage(projects,projectId,revisionId,operationId,0,treatmentRef,options);
  expect(first.verifiedRef.sha256).toMatch(/^[a-f0-9]{64}$/);
  expect((await projects.store.readFresh<{lines:Array<{asrStatus:string}>}>(first.verifiedRef.key)).value.lines[0].asrStatus).toBe('pass');
  expect(await prepareVoiceStage(projects,projectId,revisionId,operationId,0,treatmentRef,options)).toEqual(first);
  expect([generated,recognized]).toEqual([1,1]);
  await writeFile(voicePath,Buffer.from('tampered'));
  await expect(prepareVoiceStage(projects,projectId,revisionId,operationId,0,treatmentRef,options)).rejects.toThrow('VOICE_SOURCE_CHANGED');
  const changedRevision=randomUUID();
  const changedTreatment=await prepareTreatmentStage(projects,projectId,changedRevision,operationId,0,{decide:async()=>plan,limits:{projectCalls:5,projectInputTokens:200000,projectOutputTokens:20000,dailyCalls:10}});
  await expect(prepareVoiceStage(projects,projectId,changedRevision,operationId,0,changedTreatment,{...options,generate:async(dir,job)=>{
   const voice=await options.generate(dir,job);
   await updateJson(projects.store,`projects/${projectId}/control`,(c:ProjectControl)=>({...c,consentEpoch:1}));
   return voice;
  }})).rejects.toThrow('PREVIEW_STALE');
  await expect(projects.store.readFresh(`projects/${projectId}/revisions/${changedRevision}/voice-stage`)).rejects.toBeInstanceOf(StoreMissing);
 }finally{await rm(root,{recursive:true,force:true})}
});
