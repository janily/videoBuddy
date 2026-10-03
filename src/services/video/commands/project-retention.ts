import {z} from 'zod';
import type {ProjectControl} from '@/contracts/video/project';
import {createOrRead,updateJson,type AtomicStore} from '@/services/video/storage/atomic-store';
import {reconcileDeletedProject} from './delete-project';

function assertClock(now:number){if(!Number.isSafeInteger(now)||now<0||now>8640000000000000)throw Error('VALIDATION_FAILED')}
export async function coordinateProjectExpiration(store:AtomicStore,projectId:string,now=Date.now()){
 assertClock(now);if(!z.uuid().safeParse(projectId).success)throw Error('VALIDATION_FAILED');
 const control=await updateJson(store,`projects/${projectId}/control`,(c:ProjectControl)=>{
  if(c.projectId!==projectId)throw Error('RETENTION_RECORD_INVALID');
  if(c.deletedAt)return c;
  const deadline=Date.parse(c.expiresAt);if(!Number.isFinite(deadline))throw Error('RETENTION_RECORD_INVALID');
  if(deadline>now)return c;
  if(!Number.isSafeInteger(c.controlVersion)||c.controlVersion>=Number.MAX_SAFE_INTEGER||!Number.isSafeInteger(c.consentEpoch)||c.consentEpoch>=Number.MAX_SAFE_INTEGER)throw Error('RETENTION_RECORD_INVALID');
  const observedAt=new Date(now).toISOString();
  return{...c,expiration:{expiresAt:c.expiresAt,observedAt},deletedAt:observedAt,controlVersion:c.controlVersion+1,consentEpoch:c.consentEpoch+1,activeConversation:null,activeProduction:null};
 });
 if(!control.deletedAt)return{status:'retained' as const};
 return reconcileDeletedProject(store,projectId);
}

// Controls are read in bounded pages. The local inventory itself has a 50,000
// entry safety ceiling; this is not a claim of unbounded filesystem scalability.
export async function sweepRetentionPage(store:AtomicStore,options:{now?:number;pageSize?:number;cursor?:string|null}={}){
 const now=options.now??Date.now(),pageSize=options.pageSize??100,cursor=options.cursor??null;
 assertClock(now);if(!Number.isSafeInteger(pageSize)||pageSize<1||pageSize>100||cursor!==null&&!z.uuid().safeParse(cursor).success)throw Error('VALIDATION_FAILED');
 if(!store.listKeys)throw Error('RETENTION_INVENTORY_UNAVAILABLE');
 const ids=(await store.listKeys('projects',2)).flatMap(key=>{const match=key.match(/^projects\/([^/]+)\/control$/);return match&&z.uuid().safeParse(match[1]).success?[match[1]]:[]}).sort();
 const remaining=ids.filter(id=>cursor===null||id>cursor),page=remaining.slice(0,pageSize);let expired=0,failed=0;
 for(const id of page){try{const c=(await store.readFresh<ProjectControl>(`projects/${id}/control`)).value;if(!c.deletedAt&&Date.parse(c.expiresAt)<=now){const result=await coordinateProjectExpiration(store,id,now);if(result.status==='cancelling')expired++}else if(!c.deletedAt&&!Number.isFinite(Date.parse(c.expiresAt)))throw Error('RETENTION_RECORD_INVALID')}catch{failed++}}
 return{inspected:page.length,expired,failed,nextCursor:remaining.length>page.length?page.at(-1)!:null};
}

export async function runRetentionMaintenance(store:AtomicStore,now=Date.now()){
 const key='maintenance/retention',saved=await createOrRead(store,key,{cursor:null as string|null});
 const result=await sweepRetentionPage(store,{now,cursor:saved.cursor});
 await updateJson(store,key,()=>({cursor:result.nextCursor}));
 return result;
}
