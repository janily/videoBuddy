import {requestOwner}from '@/services/video/access/session';
import {projectService,json,errorResponse}from '@/services/video/http/route-utils';
export async function GET(request:Request,{params}:{params:Promise<{projectId:string;operationId:string}>}){try{const projects=projectService(),{projectId,operationId}=await params;await projects.access(requestOwner(request),projectId);return json(await projects.operation(projectId,operationId))}catch(e){return errorResponse(e)}}
