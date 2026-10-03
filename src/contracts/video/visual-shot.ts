import {z} from 'zod';
import type {Understanding} from './domain';
import {guardTreatment} from './treatment';
import {TimingDraftSchema,type TimingDraft} from '@/services/video/preview/timing-draft';
import {canonicalHash} from '@/services/video/domain/hash';
import {validateSource} from '@/services/video/media/executor';
import {getStyle} from '@/services/video/styles/registry';

const id=z.string().min(1).max(120),digest=z.string().regex(/^[a-f0-9]{64}$/);
export const VisualDirectionSchema=z.strictObject({purpose:z.string().min(1).max(3000),framing:z.string().min(1).max(1000),camera:z.string().min(1).max(1000),actorIds:z.array(id).max(80).refine(ids=>new Set(ids).size===ids.length)});
export const VisualShotSourceSchema=z.strictObject({schemaVersion:z.literal(1),briefVersion:z.number().int().nonnegative(),styleSlug:id,styleRulesHash:digest,timingDraftHash:digest,shotId:id,startFrame:z.number().int().nonnegative(),endFrame:z.number().int().positive(),factIds:z.array(id),assetIds:z.array(z.uuid()),sourceHtml:z.string().min(100).max(250000),seed:z.number().int().min(0).max(0xffffffff).optional(),direction:VisualDirectionSchema.optional()});
// Archived version-1 sources remain readable; new model output must be complete for FilmSpec assembly.
export const CompleteVisualShotSchema=VisualShotSourceSchema.required({seed:true,direction:true});
export type VisualShotSource=z.infer<typeof VisualShotSourceSchema>;

export function validateVisualSource(source:string){
 try{validateSource(source)}catch{throw Error('VISUAL_SOURCE_INVALID')}
 if(Buffer.byteLength(source)>180000||!/window\.render\s*=/.test(source)||!/window\.READY\s*=/.test(source)||/\b(?:setInterval|setTimeout|requestAnimationFrame|cancelAnimationFrame|eval|Function|Worker|SharedWorker|EventSource|RTCPeerConnection|WebSocket|XMLHttpRequest|fetch|sendBeacon|localStorage|sessionStorage|indexedDB)\s*\(/.test(source)||/\b(?:Math\.random|Date\.now|performance\.now|crypto\.getRandomValues|document\.cookie|navigator\.sendBeacon|new\s+Date)\b/.test(source)||/<(?:iframe|object|embed|script\s+[^>]*src\s*=|link\s+[^>]*href\s*=)/i.test(source))throw Error('VISUAL_SOURCE_INVALID');
 return{status:'static_pass' as const,scope:'offline source syntax only; isolated runtime and visual QA still required'};
}

export function guardVisualShot(raw:unknown,understanding:Understanding,rawTreatment:unknown,rawTiming:TimingDraft,expectedTimingHash:string,expectedSeed?:number):VisualShotSource{
 const parsed=VisualShotSourceSchema.safeParse(raw),timing=TimingDraftSchema.safeParse(rawTiming);
 if(!parsed.success||!timing.success||!digest.safeParse(expectedTimingHash).success)throw Error('VISUAL_SOURCE_INVALID');
 if(canonicalHash(timing.data)!==expectedTimingHash)throw Error('VISUAL_BASELINE_CHANGED');
 if(!understanding.preferences.styleSlug)throw Error('VISUAL_BASELINE_CHANGED');
 const style=getStyle(understanding.preferences.styleSlug),plan=guardTreatment(rawTreatment,understanding,style.rulesHash),source=parsed.data;
 if(expectedSeed!==undefined&&source.seed!==undefined&&source.seed!==expectedSeed)throw Error('VISUAL_BASELINE_CHANGED');
 const shot=plan.shots.find(item=>item.id===source.shotId),timed=timing.data.shots.find(item=>item.id===source.shotId);
 if(!shot||!timed||source.briefVersion!==understanding.briefVersion||source.styleSlug!==style.slug||source.styleRulesHash!==style.rulesHash||source.timingDraftHash!==expectedTimingHash||source.startFrame!==shot.startFrame||source.endFrame!==shot.endFrame||timed.startFrame!==shot.startFrame||timed.endFrame!==shot.endFrame||canonicalHash([...source.factIds].sort())!==canonicalHash([...shot.factIds].sort()))throw Error('VISUAL_BASELINE_CHANGED');
 const allowed=new Set(understanding.assetUses.map(use=>use.assetId));
 if(new Set(source.assetIds).size!==source.assetIds.length||source.assetIds.some(id=>!allowed.has(id)))throw Error('VISUAL_ASSET_INVALID');
 validateVisualSource(source.sourceHtml);
 return source;
}
