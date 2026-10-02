import {readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {ProjectControl} from '@/contracts/video/project';
import {AtomicStore,updateJson} from '@/services/video/storage/atomic-store';
import {ProjectStore} from '@/services/video/storage/project-store';
import {LocalAssetBytes} from './local-bytes';
import {extractPdfText} from './pdf-executor';
import {publishAudioAnalysis,publishMarkdownAnalysis,publishPdfAnalysis} from './analysis';
import {transcribeSourceAsset} from './audio-executor';
import {expireReservations,failAsset} from './reservations';

export async function runSourceAnalysisOnce(store:AtomicStore,root:string,extract:typeof extractPdfText=extractPdfText,transcribe:typeof transcribeSourceAsset=transcribeSourceAsset){
 const dirs=await readdir(join(root,'projects'),{withFileTypes:true}).catch(error=>{if((error as NodeJS.ErrnoException).code==='ENOENT')return[];throw error});
 const projects=new ProjectStore(store),bytes=new LocalAssetBytes(root);
 for(const dir of dirs){
  if(!dir.isDirectory()||!/^[a-f0-9-]{36}$/.test(dir.name))continue;
  const projectId=dir.name,key=`projects/${projectId}/control`;
  const control=await expireReservations(store,key) as ProjectControl;
  if(control.deletedAt)continue;
  for(const asset of control.assets.filter(item=>item.declaredMime==='text/markdown'&&item.status==='uploaded')){
   try{const inspected=await bytes.inspect(projectId,asset.id,'text/markdown');if(inspected.sha256!==asset.sha256||inspected.bytes!==asset.bytes)throw Error('ASSET_HASH_CONFLICT');await publishMarkdownAnalysis(projects,projectId,asset.id,inspected.path)}
   catch{await failAsset(store,key,asset.id,'ASSET_INVALID')}
  }
  for(const candidate of control.assets.filter(asset=>asset.declaredMime==='application/pdf'&&['uploaded','analyzing'].includes(asset.status))){
   const current=await updateJson(store,key,(value:ProjectControl)=>{
    const asset=value.assets.find(item=>item.id===candidate.id);
    if(!asset||!['uploaded','analyzing'].includes(asset.status))return value;
    if(asset.status==='analyzing')return value;
    return{...value,controlVersion:value.controlVersion+1,assets:value.assets.map(item=>item.id===candidate.id?{...item,status:'analyzing'}:item)};
   });
   const asset=current.assets.find(item=>item.id===candidate.id);
   if(!asset||asset.status!=='analyzing')continue;
   try{
    const inspected=await bytes.inspect(projectId,asset.id,'application/pdf');
    if(inspected.sha256!==asset.sha256||inspected.bytes!==asset.bytes)throw Error('ASSET_HASH_CONFLICT');
    const pages=await extract(inspected.path,asset.id);
    await publishPdfAnalysis(projects,projectId,asset.id,pages);
   }catch(error){
    if(error instanceof Error&&error.message==='PDF_RUNTIME_UNAVAILABLE')throw error;
    const code=error instanceof Error&&['PDF_TEXT_UNAVAILABLE','PDF_TEXT_LIMIT','PDF_EXTRACTION_FAILED','ASSET_HASH_CONFLICT'].includes(error.message)?error.message:'PDF_EXTRACTION_FAILED';
    await failAsset(store,key,asset.id,code);
   }
  }
  for(const candidate of control.assets.filter(asset=>['audio/wav','audio/mpeg','audio/mp4'].includes(asset.declaredMime)&&['uploaded','analyzing'].includes(asset.status))){
   const current=await updateJson(store,key,(value:ProjectControl)=>{
    const asset=value.assets.find(item=>item.id===candidate.id);
    if(!asset||!['uploaded','analyzing'].includes(asset.status)||asset.status==='analyzing')return value;
    return{...value,controlVersion:value.controlVersion+1,assets:value.assets.map(item=>item.id===candidate.id?{...item,status:'analyzing'}:item)};
   });
   const asset=current.assets.find(item=>item.id===candidate.id);
   if(!asset||asset.status!=='analyzing')continue;
   try{
    if(!/(?:speech|voice|narration|spoken|口播|旁白|访谈|语音|采访|讲话|台词)/i.test(asset.intendedUse))throw Error(/(?:music|bgm|配乐|音乐|音效|环境声)/i.test(asset.intendedUse)?'AUDIO_MUSIC_UNSUPPORTED':'AUDIO_USE_UNCLEAR');
    const inspected=await bytes.inspect(projectId,asset.id,asset.declaredMime);
    if(inspected.sha256!==asset.sha256||inspected.bytes!==asset.bytes)throw Error('ASSET_HASH_CONFLICT');
    const transcript=await transcribe(root,inspected.path,inspected.sha256);
    await publishAudioAnalysis(projects,projectId,asset.id,transcript);
   }catch(error){
    const message=error instanceof Error?error.message:'';
    const code=['AUDIO_USE_UNCLEAR','AUDIO_MUSIC_UNSUPPORTED','AUDIO_DURATION_UNSUPPORTED','AUDIO_TEXT_UNAVAILABLE','AUDIO_TRANSCRIPT_INCOMPLETE','VOICE_SILENT','ASSET_HASH_CONFLICT','ASR_RUNTIME_UNAVAILABLE'].includes(message)?message:message.startsWith('CAPABILITY_UNAVAILABLE:')?'AUDIO_RUNTIME_UNAVAILABLE':'AUDIO_ANALYSIS_FAILED';
    await failAsset(store,key,asset.id,code);
   }
  }
 }
}
