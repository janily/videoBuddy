import {z} from 'zod';
import type {ProjectControl} from '@/contracts/video/project';
import type {AtomicStore} from '@/services/video/storage/atomic-store';
import {createOrRead,updateJson,StoreMissing} from '@/services/video/storage/atomic-store';
import type {Environment} from '@/services/video/config/environment';

/** Quick flow: one generation produces the finished film (no preview/approve step).
 * VIDEO_FLOW=quick|staged; unset means quick in MVP and staged otherwise. */
export function quickFlow(env:Environment=process.env){return env.VIDEO_FLOW?env.VIDEO_FLOW==='quick':env.VIDEO_DELIVERY_PROFILE==='mvp'}

export const MusicChoiceSchema=z.discriminatedUnion('mode',[
 z.strictObject({mode:z.literal('auto')}),
 z.strictObject({mode:z.literal('off')}),
 z.strictObject({mode:z.literal('track'),trackId:z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/)}),
]);
export type MusicChoice=z.infer<typeof MusicChoiceSchema>;
/** Per-project choices that change the film without changing the brief:
 * the music, and which shots to draw again ("takes"). */
export const QuickSettingsSchema=z.strictObject({schemaVersion:z.literal(1),music:MusicChoiceSchema,takes:z.record(z.string().min(1).max(120),z.number().int().min(0).max(50)),takesBriefVersion:z.number().int().nonnegative()});
export type QuickSettings=z.infer<typeof QuickSettingsSchema>;
const defaults:QuickSettings={schemaVersion:1,music:{mode:'auto'},takes:{},takesBriefVersion:0};
function key(projectId:string){return`projects/${projectId}/quick/settings`}

export async function readQuickSettings(store:AtomicStore,projectId:string):Promise<QuickSettings>{
 let settings:QuickSettings;
 try{settings=QuickSettingsSchema.parse((await store.readFresh<unknown>(key(projectId))).value)}catch(error){if(!(error instanceof StoreMissing))throw error;settings=defaults}
 try{const control=(await store.readFresh<Pick<ProjectControl,'quickMusic'|'quickTakes'>>(`projects/${projectId}/control`)).value;return QuickSettingsSchema.parse({...settings,...(control.quickMusic?{music:control.quickMusic}:{}),...(control.quickTakes?{takes:control.quickTakes.takes,takesBriefVersion:control.quickTakes.briefVersion}:{})})}catch(error){if(!(error instanceof StoreMissing))throw error}
 return settings;
}
/** Takes only apply to the brief they were made for; a new brief starts fresh. */
export function takeFor(settings:QuickSettings,briefVersion:number,shotId:string){return settings.takesBriefVersion===briefVersion?settings.takes[shotId]||0:0}

export async function updateQuickSettings(store:AtomicStore,projectId:string,change:{music?:MusicChoice;redoShotId?:string;briefVersion:number}){
 // Existing standalone settings fixtures have no project control. Real projects
 // share the same atomic music source used by canvas message publication.
 const existing=await readQuickSettings(store,projectId);
 if(change.music||change.redoShotId)try{await updateJson(store,`projects/${projectId}/control`,(control:ProjectControl)=>{
  let quickTakes=control.quickTakes;
  if(change.redoShotId){const prior=quickTakes??{briefVersion:existing.takesBriefVersion,takes:existing.takes},takes=prior.briefVersion===change.briefVersion?{...prior.takes}:{};takes[change.redoShotId]=Math.min(50,(takes[change.redoShotId]||0)+1);quickTakes={briefVersion:change.briefVersion,takes}}
  return{...control,...(change.music?{quickMusic:change.music}:{}),...(quickTakes?{quickTakes}:{}),controlVersion:control.controlVersion+1};
 })}catch(error){if(!(error instanceof StoreMissing))throw error}
 await createOrRead(store,key(projectId),defaults);
 return updateJson(store,key(projectId),(raw:unknown)=>{
  const current=QuickSettingsSchema.parse(raw);
  const sameBrief=current.takesBriefVersion===change.briefVersion;
  const takes=sameBrief?{...current.takes}:{};
  if(change.redoShotId)takes[change.redoShotId]=Math.min(50,(takes[change.redoShotId]||0)+1);
  return QuickSettingsSchema.parse({...current,...(change.music?{music:change.music}:{}),takes,takesBriefVersion:change.briefVersion});
 });
}
