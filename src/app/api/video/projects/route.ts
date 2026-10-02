import {CreateProjectRequestSchema}from '@/contracts/video/commands';
import {body,writeAccess,projectService,json,errorResponse}from '@/services/video/http/route-utils';
export async function POST(request:Request){try{return json(await projectService().create(writeAccess(request),await body(request,CreateProjectRequestSchema)),201)}catch(e){return errorResponse(e)}}
