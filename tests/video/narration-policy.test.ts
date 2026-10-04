import {expect,it} from 'vitest';
import {assertPolicyRecognition} from '@/services/video/audio/narration-policy';

it('keeps same-source owner waiver distinct from ASR success and rejects missing or different speech',()=>{
 expect(()=>assertPolicyRecognition('洒下适量的水，润湿土壤。','撒下适量的水 润湿土壤')).not.toThrow();
 expect(()=>assertPolicyRecognition('观察成长，耐心照料。','观察成长 内心照料')).not.toThrow();
 for(const recognized of ['', '观察成长', '完全不同的内容文字', '观察成长耐心照料额外字'])expect(()=>assertPolicyRecognition('观察成长，耐心照料。',recognized)).toThrow('NARRATION_POLICY_RECOGNITION_CHANGED');
 expect(()=>assertPolicyRecognition('water the seed gently','water the seed softly')).not.toThrow();
 expect(()=>assertPolicyRecognition('water the seed gently','water the seed')).toThrow('NARRATION_POLICY_RECOGNITION_CHANGED');
});
