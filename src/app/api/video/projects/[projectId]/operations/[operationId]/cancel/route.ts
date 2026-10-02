import {CancelOperationRequestSchema}from '@/contracts/video/commands';
import {body,writeAccess,projectService,json,errorResponse}from '@/services/video/http/route-utils';
import {cancelReply} from '@/services/video/commands/cancel';
export async function POST(request:Request,{params}:{params:Promise<{projectId:string;operationId:string}>}){try{
 const input=await body(request,CancelOperationRequestSchema),scope=writeAccess(request),projects=projectService(),{projectId,operationId}=await params;
 await projects.access(scope,projectId);if(input.scope!=='reply')throw Error('CAPABILITY_UNAVAILABLE');
 const status=await cancelReply(projects.store,projectId,operationId);return json({status},status==='cancelling'?202:200);
}catch(e){return errorResponse(e)}}
