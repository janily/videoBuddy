import {PreparePreviewRequestSchema} from '@/contracts/video/commands';
import {body,writeAccess,projectService,json,errorResponse} from '@/services/video/http/route-utils';
import {requireGeneration} from '@/services/video/config/environment';
import {LocalOperationQueue} from '@/services/video/commands/local-queue';
import {assertWorkerReady} from '@/services/video/commands/worker-heartbeat';
import {preparePreview} from '@/services/video/preview/prepare';
export async function POST(request:Request,{params}:{params:Promise<{projectId:string}>}){
 try{
  const owner=writeAccess(request),input=await body(request,PreparePreviewRequestSchema),{projectId}=await params,projects=projectService();
  await projects.access(owner,projectId);requireGeneration();await assertWorkerReady(process.env.VIDEO_DATA_DIR!);
  return json(await preparePreview(projects,new LocalOperationQueue(projects.store,process.env.VIDEO_DATA_DIR!),owner,projectId,input),202);
 }catch(error){return errorResponse(error)}
}
