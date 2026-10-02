import {ReserveUploadRequestSchema} from '@/contracts/video/commands';
import {reserveAsset} from '@/services/video/assets/reservations';
import {body,errorResponse,json,projectService,writeAccess} from '@/services/video/http/route-utils';

export async function POST(request:Request,{params}:{params:Promise<{projectId:string}>}){
 try{
  const owner=writeAccess(request),input=await body(request,ReserveUploadRequestSchema),{projectId}=await params,projects=projectService();
  await projects.access(owner,projectId);
  const {clientCommandId,...meta}=input;
  const asset=await reserveAsset(projects.store,`projects/${projectId}/control`,meta,clientCommandId);
  return json({assetId:asset.id,reservationId:asset.reservationId,uploadUrl:`/api/video/projects/${projectId}/assets/${asset.id}/file`,expiresAt:asset.expiresAt},200);
 }catch(error){return errorResponse(error)}
}
