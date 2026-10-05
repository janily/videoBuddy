import {expect,it,vi} from 'vitest';
import type {ProjectStore} from '@/services/video/storage/project-store';
import {verifySpokenText} from '@/services/video/audio/asr';
const {plan,archive}=vi.hoisted(()=>({plan:vi.fn(),archive:vi.fn()}));
vi.mock('@/services/video/preview/voice-plan',()=>({compileVoicePlan:plan}));
vi.mock('@/services/video/audio/narration-package',async original=>({...await original<typeof import('@/services/video/audio/narration-package')>(),loadPackagedNarration:archive}));
import {archivedNarration} from '@/services/video/render/composition';
it('restores frozen pronunciation policy into the actual formal postmix verification input',async()=>{
 const raw='白紙鹽中線輕輕對折',line={lineId:'line_1',language:'zh-CN' as const,spokenText:'白纸沿中线轻轻对折。',displayText:'白纸沿中线轻轻对折。',expectedAsrText:'白纸沿中线轻轻对折。',startMs:0,reservedMs:5000};
 // Only storage/plan ports are fixtures; actual formal reconstruction and
 // pronunciation verifier run. This does not claim executed speech/media.
 plan.mockReturnValue({durationMs:20000,lines:[line]});
 archive.mockResolvedValue({source:{wav:{durationMs:3000,sha256:'a'.repeat(64)},voiceConfig:{language:'zh-CN'},audioRef:{key:'protocol-only.wav'}},words:{asrModel:'Systran/faster-whisper-medium',asrRuntimeDigest:'b'.repeat(64),voiceSha256:'a'.repeat(64),recognizedText:raw,recognitionPolicy:'mandarin_pronunciation_v1',words:[{text:raw,startMs:0,endMs:3000,probability:0.9}]}});
 const inputs={projectId:'protocol-project',bundle:{revisionId:'protocol-revision'},frozen:{treatmentPlan:{},understanding:{},audioManifest:{sources:[{id:'voice-line_1',sourceRef:{}}]}}} as Parameters<typeof archivedNarration>[2];
 const {verified}=await archivedNarration({store:{}} as ProjectStore,'/tmp/fixture',inputs),restored=verified.lines[0];
 const result=verifySpokenText(restored.expectedAsrText,restored.expectedAsrText,{language:restored.language,model:restored.asr.model,runtimeDigest:restored.asr.runtimeDigest,voiceSha256:restored.asr.voiceSha256,recognizedText:restored.recognizedText,segments:[{text:raw,startMs:0,endMs:3000,words:restored.wordTimings}]},undefined,restored.asr.recognitionPolicy);
 expect(result).toMatchObject({status:'pass',recognitionPolicy:'mandarin_pronunciation_v1',recognizedText:raw});
});
