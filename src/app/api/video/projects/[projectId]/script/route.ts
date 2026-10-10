import {z} from 'zod';
import {body,writeAccess,projectService,json,errorResponse} from '@/services/video/http/route-utils';
import {LocalOperationQueue} from '@/services/video/commands/local-queue';
import {scheduleScriptDraft} from '@/services/video/quick/script';
import {quickFlow} from '@/services/video/quick/settings';
const RequestSchema=z.strictObject({schemaVersion:z.literal(5)});
/** Retry the inexpensive script only. It never starts drawing or film production. */
export async function POST(request:Request,{params}:{params:Promise<{projectId:string}>}){
 try{
  if(!quickFlow())throw Error('CAPABILITY_UNAVAILABLE');
  const owner=writeAccess(request);await body(request,RequestSchema);
  const {projectId}=await params,projects=projectService(),control=await projects.access(owner,projectId);
  if(control.activeConversation||control.activeProduction)throw Error('BUSY');
  await scheduleScriptDraft(projects,new LocalOperationQueue(projects.store,process.env.VIDEO_DATA_DIR!),projectId,{retry:true});
  return json(await projects.view(owner,projectId),202);
 }catch(error){return errorResponse(error)}
}
