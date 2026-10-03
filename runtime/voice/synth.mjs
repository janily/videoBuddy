import {readFile,stat} from 'node:fs/promises';
import {resolve} from 'node:path';
import {KokoroTTS,env} from '@uzen/kokoro-js';
import {generateAudio} from './generate.mjs';

async function main(){
 if(process.argv[2]!=='/work/job.json')throw Error('VOICE_JOB_INVALID');
 const input=JSON.parse(await readFile('/work/job.json','utf8'));
 if(!input||typeof input.text!=='string'||input.text.length<1||input.text.length>250||
  !['zh-CN','en'].includes(input.language)||typeof input.lineId!=='string'||!/^[-a-zA-Z0-9_]{1,80}$/.test(input.lineId))throw Error('VOICE_JOB_INVALID');
 const voice=input.language==='zh-CN'?'zf_001':'af_maple';
 env.allowRemoteModels=false;
 env.cacheDir='/tmp/model-cache';
 const tts=await KokoroTTS.from_pretrained(resolve(import.meta.dirname,'model'),{
  dtype:'fp32',device:'cpu',voicePath:resolve(import.meta.dirname,'voices'),
 });
 const audio=await generateAudio(tts,input.text,voice);
 await audio.save('/output/narration.wav');
 const file=await stat('/output/narration.wav');
 if(file.size<1024||file.size>20*1024*1024)throw Error('VOICE_OUTPUT_INVALID');
 process.stdout.write(JSON.stringify({lineId:input.lineId,language:input.language,voice,bytes:file.size})+'\n');
}
main().catch(()=>{console.error('VOICE_SYNTHESIS_FAILED');process.exitCode=1});
