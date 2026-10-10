'use client';
import {AnalyticsEventSchema,type AnalyticsEvent} from './events';
/** Telemetry is best effort and cannot block a canvas action. No text is sent. */
export function trackCanvasEvent(projectId:string|null|undefined,event:AnalyticsEvent):void{
 if(!projectId||typeof window==='undefined')return;
 const safe=AnalyticsEventSchema.safeParse(event);if(!safe.success)return;
 void fetch('/api/video/analytics',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'same-origin',keepalive:true,body:JSON.stringify({eventId:crypto.randomUUID(),projectId,event:safe.data})}).catch(()=>undefined);
}
