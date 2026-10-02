import {CompleteUploadRequestSchema} from '@/contracts/video/commands';
import {LocalAssetBytes} from '@/services/video/assets/local-bytes';
import {failAsset,markUploaded} from '@/services/video/assets/reservations';
import {body,errorResponse,json,projectService,writeAccess} from '@/services/video/http/route-utils';

export async function POST(request:Request,{params}:{params:Promise<{projectId:string;assetId:string}>}){
 try{
  const owner=writeAccess(request),input=await body(request,CompleteUploadRequestSchema),{projectId,assetId}=await params,projects=projectService(),control=await projects.access(owner,projectId);
  const asset=control.assets.find(item=>item.id===assetId);
  if(!asset||asset.reservationId!==input.reservationId)throw Error('ACCESS_NOT_FOUND');
  if(asset.status!=='reserved'&&asset.status!=='uploaded')throw Error('ASSET_INVALID');
  const bytes=new LocalAssetBytes(process.env.VIDEO_DATA_DIR!);
  let result:Awaited<ReturnType<LocalAssetBytes['inspect']>>;
  try{result=await bytes.inspect(projectId,assetId,asset.declaredMime)}
  catch(error){
   if(asset.status==='reserved')await failAsset(projects.store,`projects/${projectId}/control`,assetId,'ASSET_INVALID');
   throw error;
  }
  const next=await markUploaded(projects.store,`projects/${projectId}/control`,assetId,result.sha256,result.bytes);
  return json({assetId,status:next.assets.find(item=>item.id===assetId)!.status,sha256:result.sha256,bytes:result.bytes},202);
 }catch(error){return errorResponse(error)}
}
