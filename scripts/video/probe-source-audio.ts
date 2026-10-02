import {randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {mkdtemp,mkdir,readFile,rm,writeFile} from 'node:fs/promises';
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

async function repeatedSpeechFixture(root:string,voicePath:string){
 const outputDir=join(root,'long-fixture');await mkdir(outputDir,{mode:0o700});
 const image=process.env.VIDEO_MEDIA_IMAGE_REF;
 if(!image)throw Error('CONFIGURATION_REQUIRED: pinned media image');
 const child=spawn('docker',['run','--rm','--network','none','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges','--user',`${process.getuid?.()??10001}:${process.getgid?.()??10001}`,'--mount',`type=bind,src=${voicePath},dst=/input/voice.wav,readonly`,'--mount',`type=bind,src=${outputDir},dst=/output`,image,'ffmpeg','-hide_banner','-loglevel','error','-xerror','-nostdin','-y','-stream_loop','12','-i','/input/voice.wav','-t','52','-ar','24000','-ac','1','-c:a','pcm_f32le','/output/long.wav'],{stdio:['ignore','ignore','pipe'],signal:AbortSignal.timeout(60000)});
 const errors:Buffer[]=[];child.stderr.on('data',(part:Buffer)=>{if(Buffer.concat(errors).length<4096)errors.push(part)});
 const code=await new Promise<number>((resolve,reject)=>{child.once('error',reject);child.once('close',value=>resolve(value??1))});
 if(code!==0)throw Error(`LONG_AUDIO_FIXTURE_FAILED: ${Buffer.concat(errors).toString('utf8').slice(0,200)}`);
 return readFile(join(outputDir,'long.wav'));
}
async function diverseSpeechFixture(root:string,paths:string[]){
 const outputDir=join(root,'diverse-fixture');await mkdir(outputDir,{mode:0o700});
 const image=process.env.VIDEO_MEDIA_IMAGE_REF;
 if(!image)throw Error('CONFIGURATION_REQUIRED: pinned media image');
 const mounts=paths.flatMap((path,index)=>['--mount',`type=bind,src=${path},dst=/input/${index}.wav,readonly`]);
 const inputs=paths.flatMap((_,index)=>['-i',`/input/${index}.wav`]);
 const filter=paths.map((_,index)=>`[${index}:a]`).join('')+`concat=n=${paths.length}:v=0:a=1[out]`;
 const child=spawn('docker',['run','--rm','--network','none','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges','--user',`${process.getuid?.()??10001}:${process.getgid?.()??10001}`,...mounts,'--mount',`type=bind,src=${outputDir},dst=/output`,image,'ffmpeg','-hide_banner','-loglevel','error','-xerror','-nostdin','-y',...inputs,'-filter_complex',filter,'-map','[out]','-ar','24000','-ac','1','-c:a','pcm_f32le','/output/diverse.wav'],{stdio:['ignore','ignore','pipe'],signal:AbortSignal.timeout(60000)});
 const errors:Buffer[]=[];child.stderr.on('data',(part:Buffer)=>{if(Buffer.concat(errors).length<4096)errors.push(part)});
 const code=await new Promise<number>((resolve,reject)=>{child.once('error',reject);child.once('close',value=>resolve(value??1))});
 if(code!==0)throw Error(`DIVERSE_AUDIO_FIXTURE_FAILED: ${Buffer.concat(errors).toString('utf8').slice(0,200)}`);
 return readFile(join(outputDir,'diverse.wav'));
}

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
  const longWav=await repeatedSpeechFixture(root,voice.outputPath),longAsset=await reserveAsset(store,`projects/${projectId}/control`,{filename:'重复语音.wav',declaredBytes:longWav.length,declaredMime:'audio/wav',intendedUse:'语音参考',rightsConfirmed:true},randomUUID());
  const longBytes=await new LocalAssetBytes(root).put(projectId,longAsset.id,new Request('https://video.test/file',{method:'PUT',headers:{'content-type':'audio/wav'},body:longWav,duplex:'half'} as RequestInit),{declaredMime:'audio/wav',declaredBytes:longWav.length});
  await markUploaded(store,`projects/${projectId}/control`,longAsset.id,longBytes.sha256,longBytes.bytes);
  await runSourceAnalysisOnce(store,root);
  const longControl=(await store.readFresh<ProjectControl>(`projects/${projectId}/control`)).value,longOutput=longControl.assets.find(item=>item.id===longAsset.id);
  if(longOutput?.status!=='failed'||longOutput.errorCode!=='AUDIO_TRANSCRIPT_INCOMPLETE'||longControl.inputPending)throw Error(`SOURCE_AUDIO_PROBE_FAILED: repeated speech ${longOutput?.status}/${longOutput?.errorCode}`);
  const sentences=['上海科技展将在十月八日上午开幕。','主会场设在黄浦区的文化中心。','观众可以从东门进入展厅。','第一场讲座介绍城市绿色交通。','第二场活动展示新的教育工具。','工作人员会在入口提供中文地图。','家庭观众可以参加下午的手工课。','志愿者将在每个楼层提供帮助。','晚间讨论围绕社区服务展开。','所有活动将在晚上六点结束。','参观者请在现场确认最新日程。','如需无障碍通道可以咨询服务台。','主办方提醒大家保管好个人物品。','今天的介绍到此结束谢谢大家。'];
  const voices=[];for(const [index,text] of sentences.entries())voices.push(await synthesizeVoice(root,{lineId:`diverse_${index}`,language:'zh-CN',text}));
  const diverseWav=await diverseSpeechFixture(root,voices.map(item=>item.outputPath)),diverseAsset=await reserveAsset(store,`projects/${projectId}/control`,{filename:'不同内容的长语音.wav',declaredBytes:diverseWav.length,declaredMime:'audio/wav',intendedUse:'语音参考',rightsConfirmed:true},randomUUID());
  const diverseBytes=await new LocalAssetBytes(root).put(projectId,diverseAsset.id,new Request('https://video.test/file',{method:'PUT',headers:{'content-type':'audio/wav'},body:diverseWav,duplex:'half'} as RequestInit),{declaredMime:'audio/wav',declaredBytes:diverseWav.length});
  await markUploaded(store,`projects/${projectId}/control`,diverseAsset.id,diverseBytes.sha256,diverseBytes.bytes);
  await runSourceAnalysisOnce(store,root);
  const diverseControl=(await store.readFresh<ProjectControl>(`projects/${projectId}/control`)).value,diverseOutput=diverseControl.assets.find(item=>item.id===diverseAsset.id);
  if(diverseOutput?.status!=='ready'||!diverseOutput.analysisRef||diverseControl.inputPending)throw Error(`SOURCE_AUDIO_PROBE_FAILED: diverse speech ${diverseOutput?.status}/${diverseOutput?.errorCode}`);
  const diverseAnalysis=(await store.readFresh<TextAnalysis>(diverseOutput.analysisRef.key)).value;
  if((diverseAnalysis.durationMs??0)<30000||(diverseAnalysis.chunkCount??0)<2||!diverseAnalysis.segments?.some(segment=>segment.startMs>30000))throw Error('SOURCE_AUDIO_PROBE_FAILED: diverse speech transcript incomplete');
  const evidence={sourceKind:'fresh offline TTS WAV uploaded as speech-intended asset; not a user recording',sourceSha256:wrote.sha256,sourceBytes:wrote.bytes,sourceDurationMs:voice.wav.durationMs,mediaRuntimeDigest:analysis.mediaRuntimeDigest,asrRuntimeDigest:analysis.asrRuntimeDigest,wavChunks:analysis.wavChunks,chunkCount:analysis.chunkCount,detectedLanguage:analysis.language,segments:analysis.segments,assetStatus:output.status,briefVersion:control.briefVersion,inputPending:control.inputPending,musicIntent:{status:musicResult.status,errorCode:musicResult.errorCode,inputPending:musicControl.inputPending},repeatedSpeech:{sourceSha256:longBytes.sha256,sourceBytes:longBytes.bytes,durationMs:52000,status:longOutput.status,errorCode:longOutput.errorCode,inputPending:longControl.inputPending},diverseSpeech:{sourceSha256:diverseBytes.sha256,sourceBytes:diverseBytes.bytes,durationMs:diverseAnalysis.durationMs,chunkCount:diverseAnalysis.chunkCount,wavChunks:diverseAnalysis.wavChunks,language:diverseAnalysis.language,segments:diverseAnalysis.segments,status:diverseOutput.status,inputPending:diverseControl.inputPending},limits:'Short and varied long synthetic speech with audio-coverage gate tested; human recording, music and ambient sound not validated'};
  if(process.argv.includes('--record'))await writeFile('docs/engineering/evidence/source-audio-probe.json',JSON.stringify(evidence,null,2)+'\n');
  process.stdout.write(JSON.stringify(evidence)+'\n');
 }finally{await rm(root,{recursive:true,force:true})}
}
main().catch(error=>{console.error(error);process.exitCode=1});
