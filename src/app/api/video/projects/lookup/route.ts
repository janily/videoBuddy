import{LookupProjectsRequestSchema}from'@/contracts/video/commands';
import{body,writeAccess,projectService,json,errorResponse}from'@/services/video/http/route-utils';
export async function POST(request:Request){try{const owner=writeAccess(request),input=await body(request,LookupProjectsRequestSchema);return json({projects:await projectService().lookup(owner,input.projectIds)})}catch(error){return errorResponse(error)}}
