export const unknownMediaStopMessage='还无法确认后台制作任务已停止，已有内容已保留。核实停止状态后才能开始新制作。';
/** Only a verified cleanup may remove these markers. New commands or a changed
 * consent epoch must not erase an unknown physical effect. */
export function assertMediaStopsResolved(control:{unresolvedMediaStops?:Readonly<Record<string,unknown>>}){
 if(Object.keys(control.unresolvedMediaStops||{}).length)throw Error('MEDIA_STOP_UNKNOWN');
}
/** A terminal, never-claimed reservation is durable proof of zero producers. */
export async function clearUnstartedMediaStop(store:AtomicStore,projectId:string,operationId:string){
 const op=(await store.readFresh<{status:string;canonicalRunId?:string|null;mediaAttemptStarted?:boolean}>(`projects/${projectId}/operations/${operationId}`)).value;
 if(op.status!=='cancelled'||op.canonicalRunId||op.mediaAttemptStarted)return;
 await updateJson(store,`projects/${projectId}/control`,(c:ProjectControl)=>{if(!c.unresolvedMediaStops?.[operationId])return c;const unresolvedMediaStops={...c.unresolvedMediaStops};delete unresolvedMediaStops[operationId];return{...c,controlVersion:c.controlVersion+1,unresolvedMediaStops}});
}
import type {AtomicStore} from '@/services/video/storage/atomic-store';
import {updateJson} from '@/services/video/storage/atomic-store';
import type {ProjectControl} from '@/contracts/video/project';
