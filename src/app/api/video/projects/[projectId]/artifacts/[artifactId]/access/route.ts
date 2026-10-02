import {requestOwner}from '@/services/video/access/session';
import {projectService,json,errorResponse}from '@/services/video/http/route-utils';
import {getArtifactAccess}from '@/services/video/exports/access';
export async function GET(request:Request,{params}:{params:Promise<{projectId:string;artifactId:string}>}){try{const{projectId,artifactId}=await params,purpose=new URL(request.url).searchParams.get('purpose');if(purpose!=='play'&&purpose!=='download')throw Error('VALIDATION_FAILED');return json(await getArtifactAccess(projectService(),requestOwner(request),projectId,artifactId,purpose))}catch(e){return errorResponse(e)}}
