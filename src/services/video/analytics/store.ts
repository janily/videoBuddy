import type {ProjectStore} from '@/services/video/storage/project-store';
import {createOrRead,StoreMissing,updateJson} from '@/services/video/storage/atomic-store';
import {AnalyticsRequestSchema,type AnalyticsEvent,type StoredAnalyticsEvent} from './events';
const maxEvents=500,maxProjects=100;
interface EventLog{events:StoredAnalyticsEvent[]}
export async function recordAnalyticsEvent(projects:ProjectStore,owner:string,input:AnalyticsEvent&{eventId:string;projectId:string},now=new Date()){
 const parsed=AnalyticsRequestSchema.safeParse({eventId:input.eventId,projectId:input.projectId,event:{name:input.name,payload:input.payload}});
 if(!parsed.success)throw Error('VALIDATION_FAILED');
 const {projectId,eventId,event}=parsed.data;
 await projects.access(owner,projectId);
 const key=`projects/${projectId}/analytics/events`,indexKey=`analytics/${owner}/projects`;
 await createOrRead(projects.store,key,{events:[]} as EventLog);
 await updateJson<EventLog>(projects.store,key,current=>current.events.some(e=>e.eventId===eventId)?current:{events:[...current.events,{...event,eventId,projectId,receivedAt:now.toISOString()}].slice(-maxEvents)});
 await createOrRead(projects.store,indexKey,{ids:[]} as {ids:string[]});
 await updateJson<{ids:string[]}>(projects.store,indexKey,current=>({ids:[...current.ids.filter(id=>id!==projectId),projectId].slice(-maxProjects)}));
}
function median(values:number[]){if(!values.length)return null;const sorted=[...values].sort((a,b)=>a-b),middle=Math.floor(sorted.length/2);return sorted.length%2?sorted[middle]:(sorted[middle-1]+sorted[middle])/2}
export function summarizeEvents(events:StoredAnalyticsEvent[]){
 const eventCounts:Record<string,number>={};for(const event of events)eventCounts[event.name]=(eventCounts[event.name]||0)+1;
 const styles=events.filter(event=>event.name==='style_selected');
 const results=events.filter(event=>event.name==='result_ready');
 const origins=styles.filter(event=>event.payload.origin);
 return{eventCount:events.length,projectCount:new Set(events.map(event=>event.projectId)).size,eventCounts,
  recommendationAdoptionRate:styles.length?styles.filter(event=>event.payload.fromRecommend).length/styles.length:null,
  medianResultReadyMs:median(results.map(event=>event.payload.ms)),
  medianScriptReadyMs:median(events.filter(event=>event.name==='script_ready').map(event=>event.payload.ms)),
  canvasSelectionRate:origins.length?origins.filter(event=>event.payload.origin==='canvas').length/origins.length:null,
  generationAbandonmentRate:null,
  coverage:{maxProjects,maxEventsPerProject:maxEvents,source:'observed_client_events' as const},
 };
}
export async function readAnalyticsDashboard(projects:ProjectStore,owner:string){
 let ids:string[];try{ids=(await projects.store.readFresh<{ids:string[]}>(`analytics/${owner}/projects`)).value.ids}catch(error){if(!(error instanceof StoreMissing))throw error;ids=[]}
 const groups=await Promise.all(ids.map(async id=>{
  try{await projects.access(owner,id);return(await projects.store.readFresh<EventLog>(`projects/${id}/analytics/events`)).value.events}
  catch(error){if(error instanceof StoreMissing||error instanceof Error&&['ACCESS_NOT_FOUND','PROJECT_EXPIRED'].includes(error.message))return[];throw error}
 }));
 return summarizeEvents(groups.flat());
}
