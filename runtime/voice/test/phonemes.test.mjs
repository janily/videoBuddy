import {test} from 'node:test';
import assert from 'node:assert/strict';
import {KokoroTTS} from '@uzen/kokoro-js';
import {generateAudio} from '../generate.mjs';

async function capture(text,voice='zf_001'){
 let phonemes;const tts=new KokoroTTS(undefined,value=>{phonemes=value;return{input_ids:{dims:[1,value.length+2]}}});
 tts.generate_from_ids=async()=>({protocolFixture:true});
 await generateAudio(tts,text,voice);return phonemes;
}
// Actual installed frontends with intercepted tokenizer; no acoustic QA claim.
test('noun 地 keeps di4 while the original full narration text is unchanged',async()=>{
 for(const text of ['大地','土地','适量浇水，润湿大地。']){
  const phonemes=await capture(text);assert.match(phonemes,/ㄉㄧ4/);assert.doesNotMatch(phonemes,/ㄉㄜ5/);
 }
});
test('adverbial 地 keeps neutral de5',async()=>{
 for(const text of ['慢慢地走','认真地学习','轻轻地放下'])assert.match(await capture(text),/ㄉㄜ5/);
});
test('的 in the noun 目的地 does not become the possessive particle',async()=>{
 assert.match(await capture('目的地'),/ㄇㄨ4ㄉㄧ4ㄉㄧ4/);
});
test('Chinese date normalization retains the day and month',async()=>{
 assert.match(await capture('活动在10月8日开始。'),/ㄕ十2/);assert.match(await capture('活动在10月8日开始。'),/ㄅㄚ1/);
});
test('English retains its original native phonemization path',async()=>{
 const text='The event starts in Shanghai.';let expected;
 const original=new KokoroTTS(undefined,value=>{expected=value;return{input_ids:null}});original.generate_from_ids=async()=>null;
 await original.generate(text,{voice:'af_maple',speed:1});assert.equal(await capture(text,'af_maple'),expected);
});
test('a Chinese line preserves embedded English rather than omitting it',async()=>{
 const phonemes=await capture('今天学习 hello。');assert.match(phonemes,/ㄐ/);assert.match(phonemes,/h/);
});
test('embedded English model names survive the reference numeric normalization',async()=>{
 const phonemes=await capture('今天学习 GPT-4。');assert.match(phonemes,/ㄐ/);assert.doesNotMatch(phonemes,/ㄈㄨ4/);assert.match(phonemes,/ㄙㄭ4/);assert.match(phonemes,/dʒ/);
});
test('an independent minus sign remains a negative number',async()=>{
 assert.match(await capture('温度是-4度。'),/ㄈㄨ4/);
});
test('refuses an oversized token sequence instead of silently truncating narration',async()=>{
 let modelCalls=0;const tts=new KokoroTTS(undefined,()=>({input_ids:{dims:[1,513]}}));tts.generate_from_ids=async()=>{modelCalls++};
 await assert.rejects(generateAudio(tts,'适量浇水，润湿大地。','zf_001'),/VOICE_INPUT_TOO_LONG/);assert.equal(modelCalls,0);
});
