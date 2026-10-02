import {randomUUID} from 'node:crypto';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {FileStore} from '../../src/services/video/storage/file-store';
import {ProjectStore} from '../../src/services/video/storage/project-store';
import {LocalAssetBytes} from '../../src/services/video/assets/local-bytes';
import {reserveAsset,markUploaded} from '../../src/services/video/assets/reservations';
import {runSourceAnalysisOnce} from '../../src/services/video/assets/source-worker';
import {synthesizeVoice} from '../../src/services/video/audio/voice';
import type {ProjectControl} from '../../src/contracts/video/project';
import type {TextAnalysis} from '../../src/services/video/assets/analysis';

async function main(){
 process.env.VIDEO_MEDIA_TIMEOUT_SECONDS='60';
 const root=await mkdtemp(join(tmpdir(),'vb-source-audio-probe-'));
 try{
  const store=new FileStore(root),projects=new ProjectStore(store);
  const voice=await synthesizeVoice(root,{lineId:'source_audio_probe',language:'zh-CN',text:'上海的活动将在十月八日开始。'});
  const wav=await readFile(voice.outputPath);
  const {projectId}=await projects.create('owner',{schemaVersion:5,clientCommandId:randomUUID(),clientCreateId:randomUUID()});
  const asset=await reserveAsset(store,`projects/${projectId}/control`,{filename:'实录.wav',declaredBytes:wav.length,declaredMime:'audio/wav',intendedUse:'语音参考',rightsConfirmed:true},randomUUID());
  const wrote=await new LocalAssetBytes(root).put(projectId,asset.id,new Request('https://video.test/file',{method:'PUT',headers:{'content-type':'audio/wav'},body:wav,duplex:'half'} as RequestInit),{declaredMime:'audio/wav',declaredBytes:wav.length});
  await markUploaded(store,`projects/${projectId}/control`,asset.id,wrote.sha256,wrote.bytes);
  await runSourceAnalysisOnce(store,root);
  const control=(await store.readFresh<ProjectControl>(`projects/${projectId}/control`)).value,output=control.assets.find(item=>item.id===asset.id);
  if(!output||output.status!=='ready'||!output.analysisRef||control.inputPending)throw Error(`SOURCE_AUDIO_PROBE_FAILED: ${output?.status}/${output?.errorCode}`);
  const analysis=(await store.readFresh<TextAnalysis>(output.analysisRef.key)).value;
  if(analysis.mime!=='audio/wav'||analysis.language!=='zh-CN'||!analysis.segments?.length||!analysis.text.includes('上海')||!analysis.text.includes('10月8日'))throw Error(`SOURCE_AUDIO_PROBE_FAILED: ${analysis.text}`);
  const music=await reserveAsset(store,`projects/${projectId}/control`,{filename:'配乐.wav',declaredBytes:wav.length,declaredMime:'audio/wav',intendedUse:'配乐',rightsConfirmed:true},randomUUID());
  const musicBytes=await new LocalAssetBytes(root).put(projectId,music.id,new Request('https://video.test/file',{method:'PUT',headers:{'content-type':'audio/wav'},body:wav,duplex:'half'} as RequestInit),{declaredMime:'audio/wav',declaredBytes:wav.length});
  await markUploaded(store,`projects/${projectId}/control`,music.id,musicBytes.sha256,musicBytes.bytes);
  await runSourceAnalysisOnce(store,root);
  const musicControl=(await store.readFresh<ProjectControl>(`projects/${projectId}/control`)).value,musicResult=musicControl.assets.find(item=>item.id===music.id);
  if(musicResult?.status!=='failed'||musicResult.errorCode!=='AUDIO_MUSIC_UNSUPPORTED'||musicControl.inputPending)throw Error('SOURCE_AUDIO_PROBE_FAILED: music must not become speech facts');
  const evidence={sourceKind:'fresh offline TTS WAV uploaded as speech-intended asset; not a user recording',sourceSha256:wrote.sha256,sourceBytes:wrote.bytes,sourceDurationMs:voice.wav.durationMs,mediaRuntimeDigest:analysis.mediaRuntimeDigest,asrRuntimeDigest:analysis.asrRuntimeDigest,convertedWavSha256:analysis.wavSha256,detectedLanguage:analysis.language,segments:analysis.segments,assetStatus:output.status,briefVersion:control.briefVersion,inputPending:control.inputPending,musicIntent:{status:musicResult.status,errorCode:musicResult.errorCode,inputPending:musicControl.inputPending},limits:'Short clean speech under 30 seconds only; music intent is explicitly unsupported, not turned into factual ASR; no ambient sound, long audio or human recording validated'};
  if(process.argv.includes('--record'))await writeFile('docs/engineering/evidence/source-audio-probe.json',JSON.stringify(evidence,null,2)+'\n');
  process.stdout.write(JSON.stringify(evidence)+'\n');
 }finally{await rm(root,{recursive:true,force:true})}
}
main().catch(error=>{console.error(error);process.exitCode=1});
