import {DeleteProjectRequestSchema}from '@/contracts/video/commands';
import {requestOwner}from '@/services/video/access/session';
import {body,writeAccess,projectService,json,errorResponse}from '@/services/video/http/route-utils';
import {deleteProject}from '@/services/video/commands/delete-project';
type Context={params:Promise<{projectId:string}>};
export async function GET(request:Request,{params}:Context){try{return json(await projectService().view(requestOwner(request),(await params).projectId))}catch(e){return errorResponse(e)}}
export async function DELETE(request:Request,{params}:Context){try{const owner=writeAccess(request),input=await body(request,DeleteProjectRequestSchema);return json(await deleteProject(projectService().store,owner,(await params).projectId,input),202)}catch(e){return errorResponse(e)}}
