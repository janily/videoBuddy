import type {ObjectRef} from '@/contracts/video/domain';
import type {ProjectControl} from '@/contracts/video/project';
import {canonicalHash} from '@/services/video/domain/hash';

export function assertPreviewProductionFence(control:ProjectControl,projectId:string,operationId:string,expectedConsentEpoch:number,baseline?:{briefVersion:number;understandingRef:ObjectRef}){
 if(control.projectId!==projectId||control.deletedAt||Date.parse(control.expiresAt)<=Date.now()||control.phase!=='preparing_preview'||control.activeProduction!==operationId||control.consentEpoch!==expectedConsentEpoch||control.inputPending||
  (baseline&&(control.briefVersion!==baseline.briefVersion||canonicalHash(control.understandingRef)!==canonicalHash(baseline.understandingRef))))throw Error('PREVIEW_STALE');
}
