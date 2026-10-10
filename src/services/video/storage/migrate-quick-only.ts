import {UnderstandingSchema,type Understanding} from '@/contracts/video/domain';
import type {ProjectControl} from '@/contracts/video/project';
import {canonicalHash,canonicalJson} from '@/services/video/domain/hash';
import {updateJson,StoreMissing} from './atomic-store';
import type {ProjectStore} from './project-store';

type LegacyControl=Omit<ProjectControl,'phase'|'unresolvedMediaStops'>&{phase:string;unresolvedMediaStops?:Record<string,string>;reviewPolicy?:string;previewState?:string;currentPreviewId?:string;currentApprovalId?:string;renderOutcomes?:unknown;latestRenderOutcome?:unknown};
const notice='制作流程已更新，旧版效果无需审批。请检查想法和画风，然后重新生成视频。';
async function historicalCancellationStopped(projects:ProjectStore,projectId:string,id:string){
 const key=`projects/${projectId}/operations/${id}`;
 try{
  const op=(await projects.store.readFresh<{id:string;projectId:string;status:string;canonicalRunId?:string|null;mediaAttemptStarted?:boolean}>(key)).value;
  if(op.id!==id||op.projectId!==projectId)return false;
  if(op.status==='cancelled'&&!op.canonicalRunId&&!op.mediaAttemptStarted)return true;
  const proof=(await projects.store.readFresh<{schemaVersion:number;projectId:string;operationId:string;stopped:boolean}>(key+'/media-stop-proof')).value;
  return proof.schemaVersion===1&&proof.projectId===projectId&&proof.operationId===id&&proof.stopped===true;
 }catch(error){if(error instanceof StoreMissing)return false;throw error}
}

/** Offline migration. Dry runs never create snapshots, receipts or other files. */
export async function migrateQuickOnly(projects:ProjectStore,options:{apply?:boolean}={}){
 if(!projects.store.listKeys)throw Error('STORE_INVENTORY_UNAVAILABLE');
 const report:Array<{projectId:string;status:'would_migrate'|'migrated'|'unchanged'|'blocked'}>=[];
 for(const key of await projects.store.listKeys('projects',2)){
  if(!/^projects\/[a-f0-9-]{36}\/control$/.test(key))continue;
  const before=(await projects.store.readFresh<LegacyControl>(key)).value,projectId=key.split('/')[1];
  if(before.deletedAt){report.push({projectId,status:'unchanged'});continue}
  const raw=(await projects.store.readFresh<Understanding>(before.understandingRef.key)).value;
  if(canonicalHash(raw)!==before.understandingRef.sha256||Buffer.byteLength(canonicalJson(raw))!==before.understandingRef.bytes)throw Error('UNDERSTANDING_REF_CHANGED');
  const preferences={durationSec:Math.min(30,Math.max(20,raw.preferences.durationSec)),aspect:raw.preferences.aspect,language:raw.preferences.language,styleSlug:raw.preferences.styleSlug};
  const audioIds=new Set(before.assets.filter(a=>a.declaredMime.startsWith('audio/')).map(a=>a.id));
  const normalized={...raw,preferences,assetUses:raw.assetUses.filter(a=>!audioIds.has(a.assetId))};
  const understandingChanged=canonicalHash(normalized)!==canonicalHash(raw);
  const legacy=Boolean(before.reviewPolicy||before.previewState||before.currentPreviewId||before.currentApprovalId||!['collecting','generating','ready','attention','cancelled'].includes(before.phase)||understandingChanged||before.assets.some(a=>audioIds.has(a.id)&&a.status!=='removed'));
  if(!legacy){report.push({projectId,status:'unchanged'});continue}
  // Do not infer that a missing worker means a media producer has stopped.
  if(before.activeProduction||before.activeConversation||before.activeScript||before.cancelRequestedProductionId&&!await historicalCancellationStopped(projects,projectId,before.cancelRequestedProductionId)||Object.keys(before.unresolvedMediaStops||{}).length){report.push({projectId,status:'blocked'});continue}
  if(!options.apply){report.push({projectId,status:'would_migrate'});continue}
  await updateJson(projects.store,key,async(current:LegacyControl)=>{
   if(canonicalHash(current)!==canonicalHash(before))throw Error('MIGRATION_CONFLICT');
   const next={...current};delete next.reviewPolicy;delete next.previewState;delete next.currentPreviewId;delete next.currentApprovalId;delete next.renderOutcomes;delete next.latestRenderOutcome;
   // Historical staged objects stay archived, but no longer enter quick readers.
   for(const field of ['currentResultId','previousResultId'] as const){const id=next[field];if(id&&(await projects.store.readFresh<{kind?:string}>(`projects/${projectId}/results/${id}/manifest`)).value.kind!=='quick')delete next[field]}
   const briefVersion=current.briefVersion+(understandingChanged?1:0),understanding=UnderstandingSchema.parse({...normalized,briefVersion});
   const understandingRef=understandingChanged?await projects.index.immutable(`projects/${projectId}/understanding/${briefVersion}/quick-migration`,understanding):current.understandingRef;
   return{...next,briefVersion,understandingRef,phase:next.currentResultId?'ready':'collecting',controlVersion:current.controlVersion+1,consentEpoch:current.consentEpoch+1,legacyMigrationNotice:notice,assets:current.assets.map(a=>audioIds.has(a.id)?{...a,status:'removed'}:a),inputPending:current.assets.some(a=>!audioIds.has(a.id)&&['reserved','uploading','uploaded','analyzing'].includes(a.status))};
  });
  report.push({projectId,status:'migrated'});
 }
 return report;
}
