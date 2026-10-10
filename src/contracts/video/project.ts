import type {TimingEstimates} from '@/services/video/quick/timings';
import type {GuidanceUI} from './guidance-ui';
import type {ScriptDraft} from './canvas';
import type {Understanding,ObjectRef} from './domain';
import type {AssetReservation} from '@/services/video/assets/reservations';
import type {Receipt} from '@/services/video/commands/submit';
import type {FeedbackTarget} from './commands';
export interface ArchivedMessage{ui?:GuidanceUI;origin?:'canvas';narrationPolicyAction?:{scope:'same_verified_narration';planSha256:string;verifiedSha256:string;decision:'reuse_pronunciation_without_repeated_listening'};speechReviewAction?:{scope:'single_postmix_wav';challengeSha256:string;decision:'pronunciation_correct'};id:string;ordinal:number;role:'user'|'assistant';text:string;attachmentIds?:string[];target?:FeedbackTarget|null;status:'completed'|'stopped'|'interrupted';contentVersion:number;operationId?:string;clientMessageId?:string}
export interface ProjectControl{
 quickMusic?:QuickView['music'];quickTakes?:{briefVersion:number;takes:Record<string,number>};
 activeScript?:string|null;latestScript?:{previousBase?:string;base:string;briefVersion:number;operationId:string};
 unresolvedMediaStops?:Record<string,'preview'|'render'>;
 pendingFeedbackIndexRef?:ObjectRef;
 deletion?:{schemaVersion:5;commandId:string;projectId:string;controlVersion:number;status:'cancelling'};
 expiration?:{expiresAt:string;observedAt:string};
 latestRenderOutcome?:{operationId:string;briefVersion:number;consentEpoch:number;controlVersion?:number};
 renderOutcomes?:Record<string,{status:'succeeded'|'failed'|'cancelled'|'interrupted'|'superseded';errorCode?:string;resultId?:string;resultHash?:string}>;
 publishedExports?:Record<string,string>;
 exportCancellations?:string[];
 latestPreviewOutcome?:{operationId:string;briefVersion:number;consentEpoch:number;controlVersion?:number};
 previewOutcomes?:Record<string,{status:'succeeded'|'failed'|'cancelled'|'interrupted'|'superseded';errorCode?:string}>;
 schemaVersion:5;projectId:string;ownerKeyHash:string;controlVersion:number;briefVersion:number;createdAt:string;lastUserActivityAt:string;expiresAt:string;deletedAt?:string;reviewPolicy:'preview_first';phase:'collecting'|'preparing_preview'|'preview_ready'|'rendering'|'ready'|'revising'|'attention'|'cancelled';
 understandingRef:ObjectRef;messagesIndexRef:ObjectRef;revisionIndexRef:ObjectRef;assets:AssetReservation[];inputPending:boolean;previewState:'none'|'ready'|'stale'|'expired';currentPreviewId?:string;currentApprovalId?:string;currentResultId?:string;previousResultId?:string;lastRestoreCommandId?:string;activeConversation?:string|null;activeProduction?:string|null;cancelRequestedProductionId?:string;receipts:Receipt[];consentEpoch:number;nextOrdinal:number;ordinalReservations:Record<string,{user:number;assistant:number}>;
}
export interface PublicOperation{id:string;kind:string;status:string;streamEpoch:number;stage?:string}
export interface ProductionFailure{operationId:string;errorCode:string;message:string}
export interface PublicPreview{previewId:string;revisionId:string;briefVersion:number;previewArtifactId:string;bundleHash:string;scriptHash:string;factsHash:string;script:string[];criticalFacts:{text:string;source:string}[];summary:string;expiresAt:string;state:ProjectControl['previewState']}
export interface QuickResultInfo{styleSlug:string;aspect:'16:9'|'9:16';durationSec:number;shots:{id:string;scriptLine:string;take:number}[];music:{trackId:string;title:string;license:string}|null}
export interface PublicResult{briefVersion?:number;resultId:string;artifactId:string;revisionId:string;bundleHash:string;createdAt:string;kind?:'quick';quick?:QuickResultInfo}
/** Quick flow settings the studio can change without touching the brief. */
export interface QuickView{music:{mode:'auto'}|{mode:'off'}|{mode:'track';trackId:string};tracks:{id:string;title:string;moods:string[];license:string}[]}
export interface ProjectView{timingEstimates?:TimingEstimates;script?:ScriptDraft;activeScript?:PublicOperation|null;productionFailure?:ProductionFailure;projectId:string;title:string;controlVersion:number;briefVersion:number;phase:ProjectControl['phase'];understanding:Pick<Understanding,'summary'|'subject'|'audience'|'objective'>&{facts?:{text:string;source:string}[]};preferences:Understanding['preferences'];assets:Pick<AssetReservation,'id'|'filename'|'status'|'intendedUse'|'errorCode'>[];messages:ArchivedMessage[];currentPreview:PublicPreview|null;currentResult:PublicResult|null;previousResult:PublicResult|null;activeConversation:PublicOperation|null;activeProduction:PublicOperation|null;pendingInputs:string[];actions:{kind:string;enabled:boolean;disabledReason?:string}[];expiresAt:string;quick?:QuickView}
