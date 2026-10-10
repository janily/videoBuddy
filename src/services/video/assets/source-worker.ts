import {readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {ProjectControl} from '@/contracts/video/project';
import {AtomicStore,updateJson} from '@/services/video/storage/atomic-store';
import {ProjectStore} from '@/services/video/storage/project-store';
import {LocalAssetBytes} from './local-bytes';
import {extractPdfText} from './pdf-executor';
import {publishMarkdownAnalysis,publishPdfAnalysis} from './analysis';
import {prepareImageAnalysis,type ImageAnalysisOptions} from './image-analysis-stage';
import {expireReservations,failAsset} from './reservations';

export async function runSourceAnalysisOnce(store:AtomicStore,root:string,extract:typeof extractPdfText=extractPdfText,imageOptions:ImageAnalysisOptions={}){
 const dirs=await readdir(join(root,'projects'),{withFileTypes:true}).catch(error=>{if((error as NodeJS.ErrnoException).code==='ENOENT')return[];throw error});
 const projects=new ProjectStore(store),bytes=new LocalAssetBytes(root);
 for(const dir of dirs){
  if(!dir.isDirectory()||!/^[a-f0-9-]{36}$/.test(dir.name))continue;
  const projectId=dir.name,key=`projects/${projectId}/control`;
  const control=await expireReservations(store,key) as ProjectControl;
  if(control.deletedAt||!Number.isFinite(Date.parse(control.expiresAt))||Date.parse(control.expiresAt)<=Date.now())continue;
  for(const asset of control.assets.filter(item=>item.declaredMime==='text/markdown'&&item.status==='uploaded')){
   try{const inspected=await bytes.inspect(projectId,asset.id,'text/markdown');if(inspected.sha256!==asset.sha256||inspected.bytes!==asset.bytes)throw Error('ASSET_HASH_CONFLICT');await publishMarkdownAnalysis(projects,projectId,asset.id,inspected.path)}
   catch{await failAsset(store,key,asset.id,'ASSET_INVALID')}
  }
  for(const candidate of control.assets.filter(asset=>asset.declaredMime==='application/pdf'&&['uploaded','analyzing'].includes(asset.status))){
   const current=await updateJson(store,key,(value:ProjectControl)=>{
    if(value.deletedAt||!Number.isFinite(Date.parse(value.expiresAt))||Date.parse(value.expiresAt)<=Date.now())return value;
    const asset=value.assets.find(item=>item.id===candidate.id);
    if(!asset||!['uploaded','analyzing'].includes(asset.status))return value;
    if(asset.status==='analyzing')return value;
    return{...value,controlVersion:value.controlVersion+1,assets:value.assets.map(item=>item.id===candidate.id?{...item,status:'analyzing'}:item)};
   });
   const asset=current.assets.find(item=>item.id===candidate.id);
   if(current.deletedAt||Date.parse(current.expiresAt)<=Date.now()||!asset||asset.status!=='analyzing')continue;
   try{
    const inspected=await bytes.inspect(projectId,asset.id,'application/pdf');
    if(inspected.sha256!==asset.sha256||inspected.bytes!==asset.bytes)throw Error('ASSET_HASH_CONFLICT');
    const before=(await store.readFresh<ProjectControl>(key)).value;if(before.deletedAt||Date.parse(before.expiresAt)<=Date.now())continue;
    const pages=await extract(inspected.path,asset.id);
    await publishPdfAnalysis(projects,projectId,asset.id,pages);
   }catch(error){
    if(error instanceof Error&&error.message==='PDF_RUNTIME_UNAVAILABLE')throw error;
    const code=error instanceof Error&&['PDF_TEXT_UNAVAILABLE','PDF_TEXT_LIMIT','PDF_EXTRACTION_FAILED','ASSET_HASH_CONFLICT'].includes(error.message)?error.message:'PDF_EXTRACTION_FAILED';
    await failAsset(store,key,asset.id,code);
   }
  }
  for(const candidate of control.assets.filter(asset=>['image/png','image/jpeg','image/webp'].includes(asset.declaredMime)&&['uploaded','analyzing'].includes(asset.status))){
   try{await prepareImageAnalysis(projects,root,projectId,candidate.id,imageOptions)}catch(error){
    const message=error instanceof Error?error.message:'';
    if(message.startsWith('CONFIGURATION_REQUIRED:')||message==='GENERATION_DISABLED'){
     await updateJson(store,key,(c:ProjectControl)=>{if(c.deletedAt||!Number.isFinite(Date.parse(c.expiresAt))||Date.parse(c.expiresAt)<=Date.now())return c;const a=c.assets.find(a=>a.id===candidate.id);if(!a||!['uploaded','analyzing'].includes(a.status)||a.errorCode===(message==='GENERATION_DISABLED'?'IMAGE_GENERATION_PAUSED':'IMAGE_CONFIGURATION_REQUIRED'))return c;return{...c,controlVersion:c.controlVersion+1,assets:c.assets.map(a=>a.id===candidate.id?{...a,errorCode:message==='GENERATION_DISABLED'?'IMAGE_GENERATION_PAUSED':'IMAGE_CONFIGURATION_REQUIRED'}:a)}});
     continue;
    }
    if(['ACCESS_NOT_FOUND','IMAGE_ASSET_CHANGED'].includes(message))continue;
    if(['IMAGE_INPUT_INVALID','IMAGE_INPUT_CHANGED','IMAGE_ANALYSIS_INVALID','IMAGE_ANALYSIS_CHANGED','ASSET_HASH_CONFLICT','ASSET_INVALID'].includes(message)||message.startsWith('ASSET_INVALID:')){await failAsset(store,key,candidate.id,message==='IMAGE_INPUT_CHANGED'?'ASSET_HASH_CONFLICT':'IMAGE_ANALYSIS_FAILED');continue}
    const code=['MODEL_USAGE_UNCERTAIN','EFFECT_UNKNOWN','MODEL_BUDGET_OVERRUN'].includes(message)?'IMAGE_MODEL_USAGE_UNCERTAIN':'IMAGE_ANALYSIS_RECONCILIATION_REQUIRED';
    await updateJson(store,key,(c:ProjectControl)=>{if(c.deletedAt||!Number.isFinite(Date.parse(c.expiresAt))||Date.parse(c.expiresAt)<=Date.now())return c;const a=c.assets.find(a=>a.id===candidate.id);if(!a||!['uploaded','analyzing'].includes(a.status)||a.errorCode===code)return c;return{...c,controlVersion:c.controlVersion+1,assets:c.assets.map(a=>a.id===candidate.id?{...a,errorCode:code}:a)}});
   }
  }
 }
}
