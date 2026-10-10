import {requestOwner} from '@/services/video/access/session';
import {projectService,json,errorResponse} from '@/services/video/http/route-utils';
import {readScenePreview} from '@/services/video/quick/scene-preview';
export async function GET(request:Request,{params}:{params:Promise<{projectId:string}>}){
 try{const query=new URL(request.url).searchParams,root=process.env.VIDEO_DATA_DIR;if(!root)throw Error('CONFIGURATION_REQUIRED');return json(await readScenePreview(projectService(),requestOwner(request),root,{projectId:(await params).projectId,operationId:query.get('operationId')||'',shotId:query.get('shotId')||'',take:Number(query.get('take'))}))}catch(error){return errorResponse(error)}
}
