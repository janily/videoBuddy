import{RestoreResultRequestSchema}from '@/contracts/video/commands';
import{restoreResult}from '@/services/video/results/restore';
import{body,writeAccess,projectService,json,errorResponse}from '@/services/video/http/route-utils';

export async function POST(request:Request,{params}:{params:Promise<{projectId:string;artifactId:string}>}){try{
 const input=await body(request,RestoreResultRequestSchema),owner=writeAccess(request),{projectId,artifactId}=await params,root=process.env.VIDEO_DATA_DIR;
 if(!root)throw Error('CONFIGURATION_REQUIRED');
 return json(await restoreResult(projectService(),owner,projectId,artifactId,input,root));
}catch(error){return errorResponse(error)}}
