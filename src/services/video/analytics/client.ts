'use client';
import {AnalyticsEventSchema,type AnalyticsEvent} from './events';
const welcomeEvents:AnalyticsEvent[]=[];
/** Telemetry is best effort and cannot block a canvas action. No text is sent. */
export function trackCanvasEvent(projectId:string|null|undefined,event:AnalyticsEvent):void{
 if(typeof window==='undefined')return;
 const safe=AnalyticsEventSchema.safeParse(event);if(!safe.success)return;
 if(!projectId){if(['style_library_open','style_search','style_filter'].includes(event.name)){welcomeEvents.push(safe.data);if(welcomeEvents.length>50)welcomeEvents.shift()}return}
 for(const pending of welcomeEvents.splice(0))trackCanvasEvent(projectId,pending);
 void fetch('/api/video/analytics',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'same-origin',keepalive:true,body:JSON.stringify({eventId:crypto.randomUUID(),projectId,event:safe.data})}).catch(()=>undefined);
}
