import {getRun,start} from 'workflow/api';
import {directorTurnWorkflow} from '@/workflows/video/director-turn';
import {RecoverRequestSchema} from '@/contracts/video/commands';
import {body,writeAccess,projectService,json,errorResponse} from '@/services/video/http/route-utils';
import {reconcileConversation} from '@/services/video/commands/reconcile';
import {requireGeneration} from '@/services/video/config/environment';
export async function POST(request:Request,{params}:{params:Promise<{projectId:string}>}){try{
 await body(request,RecoverRequestSchema);const owner=writeAccess(request),{projectId}=await params,projects=projectService();await projects.access(owner,projectId);
 const status=await reconcileConversation(projects.store,projectId,id=>getRun(id).status,async operationId=>{requireGeneration();await start(directorTurnWorkflow,[projectId,operationId])});
 return json({status});
}catch(error){return errorResponse(error)}}
