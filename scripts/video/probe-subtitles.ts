import {readFile,writeFile} from 'node:fs/promises';
import {compileSubtitles,formatSrt,readPinnedSubtitleFont} from '../../src/services/video/audio/subtitles';
import type {VerifiedNarrationManifest} from '../../src/services/video/audio/asr';

async function main(){
 const evidence=JSON.parse(await readFile('docs/engineering/evidence/asr-probe.json','utf8')) as {outputs:Array<{language:'zh-CN'|'en';spokenText:string;expectedAsrText:string;recognizedText:string;voiceSha256:string;voiceDurationMs:number;words:Array<{text:string;startMs:number;endMs:number;probability:number}>;status:'pass';wordTimingsStatus:'available'}>};
 if(evidence.outputs.length!==2||evidence.outputs.some(output=>output.status!=='pass'||output.wordTimingsStatus!=='available'))throw Error('SUBTITLE_PROBE_INVALID');
 const font=await readPinnedSubtitleFont();
 const manifest={durationMs:20000,lines:evidence.outputs.map((output,index)=>({lineId:`probe_${index}`,language:output.language,spokenText:output.spokenText,displayText:output.spokenText,expectedAsrText:output.expectedAsrText,startMs:index*8000+1000,durationMs:output.voiceDurationMs,reservedMs:6000,voice:{wav:{durationMs:output.voiceDurationMs,sha256:output.voiceSha256}},asrStatus:'pass',wordTimingsStatus:'available',recognizedText:output.recognizedText,wordTimings:output.words}))} as VerifiedNarrationManifest;
 const cues=compileSubtitles(manifest,24,font.glyphs),srt=formatSrt(cues);
 if(cues.length!==2||!srt.includes('上海')||!srt.includes('Shanghai')||cues.some(cue=>cue.endMs>20000))throw Error('SUBTITLE_PROBE_INVALID');
 const result={mediaRuntimeDigest:font.runtimeDigest,fontFamily:font.family,fontCharsetSha256:font.charsetSha256,fontGlyphCount:font.glyphs.size,durationMs:manifest.durationMs,fps:24,cues,srtSha256:(await import('node:crypto')).createHash('sha256').update(srt).digest('hex'),limits:'Compiled SRT and actual font glyph coverage only; burn-in, visual layout and final media QA not yet checked'};
 if(process.argv.includes('--record')){
  await writeFile('docs/engineering/evidence/subtitle-probe.srt',srt);
  await writeFile('docs/engineering/evidence/subtitle-probe.json',JSON.stringify(result,null,2)+'\n');
 }
 process.stdout.write(JSON.stringify(result)+'\n');
}
main().catch(error=>{console.error(error);process.exitCode=1});
