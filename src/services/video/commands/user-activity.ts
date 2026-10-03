import {z} from 'zod';
import type {ProjectControl} from '@/contracts/video/project';
import type {ProjectStore} from '@/services/video/storage/project-store';
import {createOrRead,updateJson} from '@/services/video/storage/atomic-store';

export function assertLiveProject(control:{deletedAt?:string;expiresAt?:string},now=Date.now()){
 if(control.deletedAt)throw Error('ACCESS_NOT_FOUND');if(!control.expiresAt||!Number.isFinite(Date.parse(control.expiresAt))||Date.parse(control.expiresAt)<=now)throw Error('PROJECT_EXPIRED');
}
export function userActivity(control?:{deletedAt?:string;expiresAt?:string},now=Date.now()){
 if(control)assertLiveProject(control,now);
 return{lastUserActivityAt:new Date(now).toISOString(),expiresAt:new Date(now+30*86400000).toISOString()};
}

// Commands without a control admission CAS keep an immutable activity timestamp.
// Cold retries can finish the same update but cannot renew retention a second time.
export async function recordUserCommandActivity(projects:ProjectStore,owner:string,projectId:string,commandId:string,hash:string){
 if(!z.uuid().safeParse(commandId).success||!z.uuid().safeParse(projectId).success||!/^[a-f0-9]{64}$/.test(hash))throw Error('VALIDATION_FAILED');
 await projects.access(owner,projectId);
 const intent=await createOrRead(projects.store,`projects/${projectId}/commands/${commandId}`,{hash});if(intent.hash!==hash)throw Error('IDEMPOTENCY_CONFLICT');
 const stamp=await createOrRead(projects.store,`projects/${projectId}/user-activity/${commandId}`,{hash,admittedAt:new Date().toISOString()});
 if(stamp.hash!==hash)throw Error('IDEMPOTENCY_CONFLICT');if(!z.string().datetime().safeParse(stamp.admittedAt).success)throw Error('RETENTION_RECORD_INVALID');
 return updateJson(projects.store,`projects/${projectId}/control`,(c:ProjectControl)=>{
  if(c.ownerKeyHash!==owner||c.deletedAt)throw Error('ACCESS_NOT_FOUND');
  if(!Number.isFinite(Date.parse(c.expiresAt))||Date.parse(c.expiresAt)<=Date.now())throw Error('PROJECT_EXPIRED');
  const last=Date.parse(c.lastUserActivityAt);if(!Number.isFinite(last)||!Number.isSafeInteger(c.controlVersion)||c.controlVersion>=Number.MAX_SAFE_INTEGER)throw Error('RETENTION_RECORD_INVALID');
  if(last>=Date.parse(stamp.admittedAt))return c;
  return{...c,...userActivity(undefined,Date.parse(stamp.admittedAt)),controlVersion:c.controlVersion+1};
 });
}
