import {spawn} from 'node:child_process';
import {resolve} from 'node:path';

// Capture the package's actual English frontend without invoking its model.
// Separate receiver preserves the real engine/tokenizer throughout conversion.
async function nativeEnglishPhonemes(tts,text){
 const frontend=Object.create(tts);
 frontend.tokenizer=phonemes=>({input_ids:phonemes});
 frontend.generate_from_ids=async input=>input;
 return frontend.generate(text,{voice:'af_maple',speed:1});
}
async function runFrontend(text,english,mode){
 const child=spawn('python3',[resolve(import.meta.dirname,'phonemize.py')],{stdio:['pipe','pipe','pipe'],signal:AbortSignal.timeout(15000)});
 const output=[];let length=0;
 child.stdout.on('data',part=>{length+=part.length;if(length<=65536)output.push(part);else child.kill()});
 child.stderr.resume();
 const exited=new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',code=>resolve(code))});
 child.stdin.on('error',()=>{});child.stdin.end(JSON.stringify({text,english,mode}));
 const code=await exited;
 if(code!==0||length>65536)throw Error('VOICE_PHONEMIZATION_FAILED');
 return JSON.parse(Buffer.concat(output).toString('utf8'));
}
export async function chinesePhonemes(tts,text){
 // Ask the actual reference frontend for fragments after its normalization.
 // Matching the original input would lose model names such as GPT-4.
 const discovery=await runFrontend(text,{},'discover');
 if(!Array.isArray(discovery.fragments)||discovery.fragments.length>125||discovery.fragments.some(fragment=>typeof fragment!=='string'||!fragment.length||fragment.length>250))throw Error('VOICE_PHONEMIZATION_FAILED');
 const english=Object.create(null);
 for(const fragment of discovery.fragments)if(!(fragment in english))english[fragment]=await nativeEnglishPhonemes(tts,fragment);
 const result=await runFrontend(text,english,'phonemize');
 if(typeof result.phonemes!=='string'||!result.phonemes.trim()||result.phonemes.length>8000||result.phonemes.includes('❓'))throw Error('VOICE_PHONEMIZATION_FAILED');
 return result.phonemes;
}
export async function generateAudio(tts,text,voice){
 if(voice!=='zf_001')return tts.generate(text,{voice,speed:1});
 const phonemes=await chinesePhonemes(tts,text),{input_ids}=tts.tokenizer(phonemes,{truncation:false});
 if(!Array.isArray(input_ids?.dims)||input_ids.dims.length!==2||input_ids.dims[0]!==1||!Number.isSafeInteger(input_ids.dims[1])||input_ids.dims[1]<3||input_ids.dims[1]>512)throw Error('VOICE_INPUT_TOO_LONG');
 return tts.generate_from_ids(input_ids,{voice,speed:1});
}
