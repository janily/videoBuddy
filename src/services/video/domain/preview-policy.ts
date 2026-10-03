import type { ApprovePreviewRequest } from '@/contracts/video/commands';
import {assertMediaStopsResolved} from '@/services/video/media/stop-state';
export interface PreviewBaseline { previewId:string;revisionId:string;briefVersion:number;bundleHash:string;scriptHash:string;factsHash:string;expiresAt:string }
export interface ApprovalControl { unresolvedMediaStops?:Record<string,'preview'|'render'>;controlVersion?:number; briefVersion:number;inputPending:boolean;previewState:string;currentPreviewId?:string;deletedAt?:string;expiresAt?:string;activeProduction?:{status:string}|null }
export function assertPreviewBaseline(control:ApprovalControl,preview:PreviewBaseline,request:ApprovePreviewRequest,now=Date.now()) {
 if(control.deletedAt)throw Error('ACCESS_NOT_FOUND');
 if(control.expiresAt&&Date.parse(control.expiresAt)<=now)throw Error('PROJECT_EXPIRED');
 assertMediaStopsResolved(control);
 if(control.inputPending)throw Error('INPUT_PENDING');
 if(control.activeProduction&&!['succeeded','cancelled','failed','interrupted','superseded'].includes(control.activeProduction.status))throw Error('BUSY');
 if(control.previewState!=='ready'||control.currentPreviewId!==preview.previewId||control.briefVersion!==preview.briefVersion||request.expectedBriefVersion!==preview.briefVersion||!Number.isFinite(Date.parse(preview.expiresAt))||Date.parse(preview.expiresAt)<=now)throw Error('PREVIEW_STALE');
 for(const key of ['previewId','revisionId','bundleHash','scriptHash','factsHash'] as const)if(request[key]!==preview[key])throw Error('PREVIEW_STALE');
}
