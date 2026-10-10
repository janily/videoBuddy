import {requestOwner} from '@/services/video/access/session';
import {AnalyticsRequestSchema} from '@/services/video/analytics/events';
import {recordAnalyticsEvent,readAnalyticsDashboard} from '@/services/video/analytics/store';
import {body,errorResponse,json,projectService,writeAccess} from '@/services/video/http/route-utils';
export async function POST(request:Request){try{
 const owner=writeAccess(request),input=await body(request,AnalyticsRequestSchema);
 await recordAnalyticsEvent(projectService(),owner,{...input.event,eventId:input.eventId,projectId:input.projectId});
 return json({saved:true},201);
}catch(error){return errorResponse(error)}}
export async function GET(request:Request){try{return json(await readAnalyticsDashboard(projectService(),requestOwner(request)))}catch(error){return errorResponse(error)}}
