import {LocalOperationQueue} from '@/services/video/commands/local-queue';
import {RecoverRequestSchema} from '@/contracts/video/commands';
import {body,writeAccess,projectService,json,errorResponse} from '@/services/video/http/route-utils';
import {reconcileConversation} from '@/services/video/commands/reconcile';
import {requireGeneration} from '@/services/video/config/environment';
import {coordinateProjectExpiration} from '@/services/video/commands/project-retention';
import {recordUserCommandActivity} from '@/services/video/commands/user-activity';
import {canonicalHash} from '@/services/video/domain/hash';
export async function POST(request:Request,{params}:{params:Promise<{projectId:string}>}){try{
 const input=await body(request,RecoverRequestSchema);const owner=writeAccess(request),{projectId}=await params,projects=projectService();try{await projects.access(owner,projectId)}catch(error){if(!(error instanceof Error)||error.message!=='PROJECT_EXPIRED')throw error;const result=await coordinateProjectExpiration(projects.store,projectId);if(result.status!=='retained')throw error;await projects.access(owner,projectId)}
 await recordUserCommandActivity(projects,owner,projectId,input.clientCommandId,canonicalHash({kind:'recover',body:input}));
 const queue=new LocalOperationQueue(projects.store,process.env.VIDEO_DATA_DIR!);const status=await reconcileConversation(projects.store,projectId,async id=>{const operation=(await projects.store.readFresh<{status:string}>(`projects/${projectId}/operations/${id}`)).value;return operation.status==='succeeded'?'completed':operation.status==='cancelled'?'cancelled':operation.status==='interrupted'?'failed':'running'},async operationId=>{requireGeneration();await queue.enqueue(projectId,operationId,'chat')});
 return json({status});
}catch(error){return errorResponse(error)}}
