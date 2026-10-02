import {LocalAssetBytes} from '@/services/video/assets/local-bytes';
import {errorResponse,json,projectService,writeAccess} from '@/services/video/http/route-utils';

export async function PUT(request:Request,{params}:{params:Promise<{projectId:string;assetId:string}>}){
 try{
  const owner=writeAccess(request),{projectId,assetId}=await params,projects=projectService(),control=await projects.access(owner,projectId);
  const asset=control.assets.find(item=>item.id===assetId);
  if(!asset)throw Error('ACCESS_NOT_FOUND');
  if(asset.status!=='reserved'&&asset.status!=='uploaded')throw Error('ASSET_INVALID');
  if(asset.status==='reserved'&&Date.parse(asset.expiresAt)<=Date.now())throw Error('ASSET_INVALID: reservation expired');
  if(request.headers.get('content-type')!==asset.declaredMime)throw Error('ASSET_INVALID: MIME mismatch');
  const bytes=new LocalAssetBytes(process.env.VIDEO_DATA_DIR!);
  const result=await bytes.put(projectId,assetId,request,{declaredMime:asset.declaredMime,declaredBytes:asset.declaredBytes});
  return json({assetId,sha256:result.sha256,bytes:result.bytes,status:'uploaded_bytes'});
 }catch(error){return errorResponse(error)}
}
