import {body,writeAccess,projectService,json,errorResponse} from '@/services/video/http/route-utils';
import {CanvasPreferencesRequestSchema,CanvasPreferencesBusy,updateCanvasPreferences} from '@/services/video/commands/canvas-preferences';
import {LocalOperationQueue} from '@/services/video/commands/local-queue';
import {scheduleScriptDraft} from '@/services/video/quick/script';

export async function POST(request:Request,{params}:{params:Promise<{projectId:string}>}){
 try{
  const owner=writeAccess(request),input=await body(request,CanvasPreferencesRequestSchema),{projectId}=await params,projects=projectService();
  await updateCanvasPreferences(projects,owner,projectId,input);
  // Only a script draft is scheduled. Worker reconciliation recovers a failed
  // enqueue or a process exit here; the saved preference never reports failure
  // merely because this optional follow-up is temporarily unavailable.
  await scheduleScriptDraft(projects,new LocalOperationQueue(projects.store,process.env.VIDEO_DATA_DIR!),projectId).catch(()=>null);
  return json(await projects.view(owner,projectId));
 }catch(error){
  if(error instanceof CanvasPreferencesBusy)return json({error:{code:'BUSY',message:error.lane==='production'?'视频正在生成，这次设置尚未保存。请等生成结束后，再调整下一版的时长或比例。':'助手正在回复，这次设置尚未保存。请等回复结束后再调整。',retryable:true,requestId:crypto.randomUUID()}},409);
  return errorResponse(error);
 }
}
