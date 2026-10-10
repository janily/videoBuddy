import {z} from 'zod';
import {validateSource,sourceForStaticInspection} from '@/services/video/media/local/source';

const id=z.string().min(1).max(120),digest=z.string().regex(/^[a-f0-9]{64}$/);
export const VisualDirectionSchema=z.strictObject({purpose:z.string().min(1).max(3000),framing:z.string().min(1).max(1000),camera:z.string().min(1).max(1000),actorIds:z.array(id).max(80).refine(ids=>new Set(ids).size===ids.length)});
export const VisualShotSourceSchema=z.strictObject({schemaVersion:z.literal(1),briefVersion:z.number().int().nonnegative(),styleSlug:id,styleRulesHash:digest,timingDraftHash:digest,shotId:id,startFrame:z.number().int().nonnegative(),endFrame:z.number().int().positive(),factIds:z.array(id),assetIds:z.array(z.uuid()),sourceHtml:z.string().min(100).max(250000),seed:z.number().int().min(0).max(0xffffffff).optional(),direction:VisualDirectionSchema.optional()});
// Archived version-1 sources remain readable; new model output must be complete for FilmSpec assembly.
export const CompleteVisualShotSchema=VisualShotSourceSchema.required({seed:true,direction:true});
export type VisualShotSource=z.infer<typeof VisualShotSourceSchema>;

export function validateVisualSource(source:string){
 try{validateSource(source)}catch{throw Error('VISUAL_SOURCE_INVALID')}
 const inspected=sourceForStaticInspection(source);
 if(Buffer.byteLength(source)>180000||!/window\.render\s*=/.test(inspected)||!/window\.READY\s*=/.test(inspected)||/\b(?:setInterval|setTimeout|requestAnimationFrame|cancelAnimationFrame|eval|Function|Worker|SharedWorker|EventSource|RTCPeerConnection|WebSocket|XMLHttpRequest|fetch|sendBeacon|localStorage|sessionStorage|indexedDB)\s*\(/.test(inspected)||/\b(?:Math\.random|Date\.now|performance\.now|crypto\.getRandomValues|document\.cookie|navigator\.sendBeacon|new\s+Date)\b/.test(inspected)||/<(?:iframe|object|embed|script\s+[^>]*src\s*=|link\s+[^>]*href\s*=)/i.test(inspected))throw Error('VISUAL_SOURCE_INVALID');
 return{status:'static_pass' as const,scope:'offline source syntax only; isolated runtime and visual QA still required'};
}

