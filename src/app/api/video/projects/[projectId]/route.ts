import {DeleteProjectRequestSchema}from '@/contracts/video/commands';
import {requestOwner}from '@/services/video/access/session';
import {body,writeAccess,projectService,json,errorResponse}from '@/services/video/http/route-utils';
type Context={params:Promise<{projectId:string}>};
export async function GET(request:Request,{params}:Context){try{return json(await projectService().view(requestOwner(request),(await params).projectId))}catch(e){return errorResponse(e)}}
export async function DELETE(request:Request,{params}:Context){try{await body(request,DeleteProjectRequestSchema);return json(await projectService().tombstone(writeAccess(request),(await params).projectId),202)}catch(e){return errorResponse(e)}}
