import {CancelOperationRequestSchema}from '@/contracts/video/commands';
import {body,writeAccess,projectService,json,errorResponse}from '@/services/video/http/route-utils';
import {cancelProduction,cancelReply} from '@/services/video/commands/cancel';
import {cancelExport} from '@/services/video/exports/operation';
import {LocalEventLog} from '@/services/video/stream/local-event-log';
export async function POST(request:Request,{params}:{params:Promise<{projectId:string;operationId:string}>}){try{
 const input=await body(request,CancelOperationRequestSchema),scope=writeAccess(request),projects=projectService(),{projectId,operationId}=await params;
 await projects.access(scope,projectId);
 const status=input.scope==='export'?await cancelExport(projects,scope,projectId,operationId,new LocalEventLog(process.env.VIDEO_DATA_DIR!)):input.scope==='reply'?await cancelReply(projects.store,projectId,operationId):await cancelProduction(projects.store,projectId,operationId);
 return json({status},status==='cancelling'?202:200);
}catch(e){return errorResponse(e)}}
