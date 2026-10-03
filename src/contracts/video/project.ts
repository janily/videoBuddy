import type {Understanding,ObjectRef} from './domain';
import type {AssetReservation} from '@/services/video/assets/reservations';
import type {Receipt} from '@/services/video/commands/submit';
export interface ArchivedMessage{id:string;ordinal:number;role:'user'|'assistant';text:string;attachmentIds?:string[];status:'completed'|'stopped'|'interrupted';contentVersion:number;operationId?:string;clientMessageId?:string}
export interface ProjectControl{
 latestRenderOutcome?:{operationId:string;briefVersion:number;consentEpoch:number;controlVersion?:number};
 renderOutcomes?:Record<string,{status:'succeeded'|'failed'|'cancelled'|'superseded';errorCode?:string;resultId?:string;resultHash?:string}>;
 publishedExports?:Record<string,string>;
 exportCancellations?:string[];
 latestPreviewOutcome?:{operationId:string;briefVersion:number;consentEpoch:number;controlVersion?:number};
 previewOutcomes?:Record<string,{status:'succeeded'|'failed'|'cancelled'|'superseded';errorCode?:string}>;
 schemaVersion:5;projectId:string;ownerKeyHash:string;controlVersion:number;briefVersion:number;createdAt:string;lastUserActivityAt:string;expiresAt:string;deletedAt?:string;reviewPolicy:'preview_first';phase:'collecting'|'preparing_preview'|'preview_ready'|'rendering'|'ready'|'revising'|'attention'|'cancelled';
 understandingRef:ObjectRef;messagesIndexRef:ObjectRef;revisionIndexRef:ObjectRef;assets:AssetReservation[];inputPending:boolean;previewState:'none'|'ready'|'stale'|'expired';currentPreviewId?:string;currentApprovalId?:string;currentResultId?:string;previousResultId?:string;lastRestoreCommandId?:string;activeConversation?:string|null;activeProduction?:string|null;cancelRequestedProductionId?:string;receipts:Receipt[];consentEpoch:number;nextOrdinal:number;ordinalReservations:Record<string,{user:number;assistant:number}>;
}
export interface PublicOperation{id:string;kind:string;status:string;streamEpoch:number;stage?:string}
export interface ProductionFailure{operationId:string;errorCode:string;message:string}
export interface PublicPreview{previewId:string;revisionId:string;briefVersion:number;previewArtifactId:string;bundleHash:string;scriptHash:string;factsHash:string;script:string[];criticalFacts:{text:string;source:string}[];summary:string;expiresAt:string;state:ProjectControl['previewState']}
export interface PublicResult{resultId:string;artifactId:string;revisionId:string;bundleHash:string;createdAt:string}
export interface ProjectView{productionFailure?:ProductionFailure;projectId:string;title:string;controlVersion:number;briefVersion:number;phase:ProjectControl['phase'];understanding:Pick<Understanding,'summary'|'subject'>;preferences:Understanding['preferences'];assets:Pick<AssetReservation,'id'|'filename'|'status'|'intendedUse'|'errorCode'>[];messages:ArchivedMessage[];currentPreview:PublicPreview|null;currentResult:PublicResult|null;previousResult:PublicResult|null;activeConversation:PublicOperation|null;activeProduction:PublicOperation|null;pendingInputs:string[];actions:{kind:string;enabled:boolean;disabledReason?:string}[];expiresAt:string}
