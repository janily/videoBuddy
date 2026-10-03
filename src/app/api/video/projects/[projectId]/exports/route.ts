import {ExportRequestSchema} from '@/contracts/video/commands';
import {body,writeAccess,projectService,json,errorResponse} from '@/services/video/http/route-utils';
import {LocalOperationQueue} from '@/services/video/commands/local-queue';
import {requestExport} from '@/services/video/exports/request';
export async function POST(request:Request,{params}:{params:Promise<{projectId:string}>}){
 try{
  const owner=writeAccess(request),input=await body(request,ExportRequestSchema),{projectId}=await params,projects=projectService(),root=process.env.VIDEO_DATA_DIR;
  if(!root)throw Error('CONFIGURATION_REQUIRED');
  const result=await requestExport(projects,new LocalOperationQueue(projects.store,root),owner,projectId,input,root);
  return json(result,result.status);
 }catch(error){return errorResponse(error)}
}
