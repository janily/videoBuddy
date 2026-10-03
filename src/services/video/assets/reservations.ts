import {randomUUID} from 'node:crypto';
import {AtomicStore,updateJson} from '@/services/video/storage/atomic-store';
import {canonicalHash} from '@/services/video/domain/hash';
import type {ObjectRef} from '@/contracts/video/domain';
export interface AssetReservation{id:string;commandId:string;bodyHash:string;reservationId:string;filename:string;declaredBytes:number;declaredMime:string;intendedUse:string;rightsConfirmed:boolean;status:string;expiresAt:string;sha256?:string;bytes?:number;analysisRef?:ObjectRef;errorCode?:string;quotaReserved:boolean}
export interface AssetsControl{assets:AssetReservation[];inputPending:boolean;deletedAt?:string;expiresAt?:string;lastUserActivityAt?:string}
export interface UploadInput{filename:string;declaredBytes:number;declaredMime:string;intendedUse:string;rightsConfirmed:boolean}
const limits:Record<string,number>={'text/markdown':1024*1024,'image/png':20*1024*1024,'image/jpeg':20*1024*1024,'image/webp':20*1024*1024,'application/pdf':20*1024*1024,'audio/wav':50*1024*1024,'audio/mpeg':50*1024*1024,'audio/mp4':50*1024*1024};
function pending(assets:AssetReservation[]){return assets.some(a=>['reserved','uploading','uploaded','analyzing'].includes(a.status))}
function assertLive(c:AssetsControl){if(c.deletedAt)throw Error('ACCESS_NOT_FOUND');if(c.expiresAt&&(!Number.isFinite(Date.parse(c.expiresAt))||Date.parse(c.expiresAt)<=Date.now()))throw Error('PROJECT_EXPIRED')}
function userActivity(c:AssetsControl){if(!c.lastUserActivityAt||!c.expiresAt)return{};const now=Date.now();return{lastUserActivityAt:new Date(now).toISOString(),expiresAt:new Date(now+30*86400000).toISOString()}}
export async function reserveAsset(store:AtomicStore,key:string,input:UploadInput,commandId:string){
 if(!limits[input.declaredMime]||!Number.isSafeInteger(input.declaredBytes)||input.declaredBytes<1||input.declaredBytes>limits[input.declaredMime]||!input.rightsConfirmed||/[\u0000-\u001f]/.test(input.filename))throw Error('ASSET_INVALID');
 const bodyHash=canonicalHash(input);const asset:AssetReservation={...input,id:randomUUID(),reservationId:randomUUID(),commandId,bodyHash,status:'reserved',expiresAt:new Date(Date.now()+600000).toISOString(),quotaReserved:true};
 const next=await updateJson(store,key,(c:AssetsControl)=>{
  assertLive(c);
  const old=c.assets.find(a=>a.commandId===commandId);if(old){if(old.bodyHash!==bodyHash)throw Error('IDEMPOTENCY_CONFLICT');return c}
  const counted=c.assets.filter(a=>a.status!=='removed'&&a.quotaReserved!==false);
  if(counted.length>=10||counted.reduce((sum,a)=>sum+a.declaredBytes,0)+input.declaredBytes>150*1024*1024)throw Error('ASSET_LIMIT');
  return{...c,...userActivity(c),...('controlVersion'in c&&typeof c.controlVersion==='number'?{controlVersion:c.controlVersion+1}:{}),assets:[...c.assets,asset],inputPending:true};
 });return next.assets.find(a=>a.commandId===commandId)!;
}
export async function failAsset(store:AtomicStore,key:string,id:string,errorCode:string){return updateJson(store,key,(c:AssetsControl)=>{const assets=c.assets.map(a=>a.id===id&&!['ready','removed'].includes(a.status)?{...a,status:'failed',errorCode,quotaReserved:!!a.sha256}:a);if(assets.every((asset,index)=>asset===c.assets[index]))return c;return{...c,...('controlVersion'in c&&typeof c.controlVersion==='number'?{controlVersion:c.controlVersion+1}:{}),assets,inputPending:pending(assets)}})}
export async function markUploaded(store:AtomicStore,key:string,id:string,sha256:string,bytes:number){return updateJson(store,key,(c:AssetsControl)=>{
 assertLive(c);
 const existing=c.assets.find(a=>a.id===id);if(!existing)throw Error('ACCESS_NOT_FOUND');
 if(existing.sha256){if(existing.sha256!==sha256)throw Error('ASSET_HASH_CONFLICT');return c}
 if(Date.parse(existing.expiresAt)<=Date.now()||bytes>existing.declaredBytes)throw Error('ASSET_INVALID');
 const assets=c.assets.map(a=>a.id===id?{...a,status:'uploaded',sha256,bytes}:a);return{...c,...userActivity(c),...('controlVersion'in c&&typeof c.controlVersion==='number'?{controlVersion:c.controlVersion+1}:{}),assets,inputPending:pending(assets)};
})}
export async function expireReservations(store:AtomicStore,key:string,now=Date.now()){
 const current=(await store.readFresh<AssetsControl>(key)).value;
 const expired=(asset:AssetReservation)=>(asset.status==='reserved'&&Date.parse(asset.expiresAt)<=now)||(['uploaded','analyzing'].includes(asset.status)&&Date.parse(asset.expiresAt)+300000<=now);
 if(!current.assets.some(expired))return current;
 return updateJson(store,key,(c:AssetsControl)=>{
 const assets=c.assets.map(asset=>expired(asset)?{...asset,status:'failed',errorCode:asset.status==='reserved'?'UPLOAD_EXPIRED':'ANALYSIS_TIMEOUT',quotaReserved:!!asset.sha256}:asset);
 if(assets.every((asset,index)=>asset===c.assets[index]))return c;
 return{...c,...('controlVersion'in c&&typeof c.controlVersion==='number'?{controlVersion:c.controlVersion+1}:{}),assets,inputPending:pending(assets)};
})}
