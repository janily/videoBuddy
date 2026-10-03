import {createHash} from 'node:crypto';
import {mkdtemp,mkdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {expect,it,vi} from 'vitest';
import type {NarrationPlan} from '@/services/video/audio/narration';
import type {VerifiedNarrationManifest} from '@/services/video/audio/asr';

const state=vi.hoisted(()=>({active:true,inspections:0,transcriptions:0}));
vi.mock('@/services/video/audio/wav',async importOriginal=>({...await importOriginal<typeof import('@/services/video/audio/wav')>(),inspectVoiceWav:async()=>{state.inspections++;return{sha256:'a'.repeat(64)}}}));
vi.mock('@/services/video/audio/asr',async importOriginal=>({...await importOriginal<typeof import('@/services/video/audio/asr')>(),transcribeAudio:async()=>{state.transcriptions++;state.active=false;return{}}}));
import {verifyPostMixNarration} from '@/services/video/audio/postmix-asr';

it('does not inspect or transcribe another line after cancellation during the first ASR',async()=>{
 const root=await mkdtemp(join(tmpdir(),'vb-postmix-cancel-')),directory=join(root,'composition','stage');await mkdir(directory,{recursive:true});
 const outputPath=join(directory,'final.mp4'),bytes=Buffer.alloc(2048);await writeFile(outputPath,bytes);
 const film={outputPath,sha256:createHash('sha256').update(bytes).digest('hex'),durationMs:20000,technicalQa:'pass' as const};
 const plan:NarrationPlan={durationMs:20000,lines:[1000,8000].map((startMs,index)=>({lineId:String(index),language:'en',spokenText:'Hello',displayText:'Hello',expectedAsrText:'Hello',startMs,reservedMs:3000}))};
 const verified={durationMs:20000,lines:plan.lines.map(line=>({...line,durationMs:1000.0416666666666,asrStatus:'pass',wordTimingsStatus:'available'}))} as VerifiedNarrationManifest;
 const env={VIDEO_MEDIA_IMAGE_REF:'sha256:'+'b'.repeat(64),VIDEO_MEDIA_RUNTIME_DIGEST:'b'.repeat(64),VIDEO_MEDIA_TIMEOUT_SECONDS:'600'};
 await expect(verifyPostMixNarration(root,film,plan,verified,env,undefined,{assertActive:async()=>{if(!state.active)throw Error('RENDER_FENCED')}})).rejects.toThrow('RENDER_FENCED');
 expect(state.transcriptions).toBe(1);expect(state.inspections).toBe(1);
});
