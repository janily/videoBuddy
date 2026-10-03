import {z} from 'zod';
import {ObjectRefSchema,type ObjectRef} from '@/contracts/video/domain';
import type {ArchivedMessage,ProjectControl} from '@/contracts/video/project';
import type {ProjectStore} from '@/services/video/storage/project-store';
import {createOrRead} from '@/services/video/storage/atomic-store';
import {canonicalHash,canonicalJson} from '@/services/video/domain/hash';
import {exportBaseline} from '@/services/video/exports/publication';
import {MusicGainOperationSchema} from './music-gain';
const Id=z.uuid(),Digest=z.string().regex(/^[a-f0-9]{64}$/),Counter=z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const MusicProposal=z.strictObject({schemaVersion:z.literal(5),changePlanId:Id,sourceMessageId:Id,targetArtifactId:Id,revisionId:Id,operations:z.tuple([MusicGainOperationSchema]),factsChanged:z.literal(false),reason:z.string().min(1).max(1000)});
const Draft=MusicProposal.extend({projectId:Id,ownerKeyHash:Digest,candidateRisk:z.literal('safe_direct'),scope:z.literal('entire_film'),authorizationSource:z.literal('explicit_message'),sourceMessageSha256:Digest,baseline:z.strictObject({resultId:Id,resultHash:Digest,bundleHash:Digest,consentEpoch:Counter,briefVersion:Counter}),requiredQualityChecks:z.array(z.string().min(1)).min(1),budgetReservation:z.null(),execution:z.literal('not_started')});
export type MusicChangeDraft=z.infer<typeof Draft>;
async function verifiedRead<T>(projects:ProjectStore,ref:ObjectRef,prefix:string):Promise<T>{
 if(!ref.key.startsWith(prefix)||ref.mime!=='application/json')throw Error('CHANGE_SOURCE_INVALID');
 const value=(await projects.store.readFresh<T>(ref.key)).value;
 if(canonicalHash(value)!==ref.sha256||Buffer.byteLength(canonicalJson(value))!==ref.bytes)throw Error('CHANGE_SOURCE_INVALID');return value;
}
async function sourceMessage(projects:ProjectStore,control:ProjectControl,messageId:string){
 const prefix=`projects/${control.projectId}/`,indexPrefix=prefix+'indexes/messages/';
 const root=await verifiedRead<{chunks:ObjectRef[];count:number}>(projects,control.messagesIndexRef,indexPrefix);
 if(!Array.isArray(root.chunks)||root.chunks.length>10||!Number.isSafeInteger(root.count)||root.count<0||root.count>1000)throw Error('CHANGE_SOURCE_INVALID');
 const entries=(await Promise.all(root.chunks.map(ref=>verifiedRead<{id:string;ordinal:number;ref:ObjectRef}[]>(projects,ObjectRefSchema.parse(ref),indexPrefix+'chunks/')))).flat();
 if(entries.length!==root.count||new Set(entries.map(e=>e.id)).size!==entries.length)throw Error('CHANGE_SOURCE_INVALID');
 const entry=entries.find(e=>e.id===messageId);if(!entry)throw Error('CHANGE_AUTHORIZATION_REQUIRED');
 const message=await verifiedRead<ArchivedMessage>(projects,ObjectRefSchema.parse(entry.ref),prefix+`messages/${messageId}/`);
 if(message.id!==messageId||message.ordinal!==entry.ordinal)throw Error('CHANGE_SOURCE_INVALID');
 if(message.role!=='user'||message.status!=='completed'||!Id.safeParse(message.clientMessageId).success||!Id.safeParse(message.operationId).success||!message.target||message.target.sourceTimeMs!==null||message.target.previewTimeMs!==undefined)throw Error('CHANGE_AUTHORIZATION_REQUIRED');
 return message;
}
function assertReady(control:ProjectControl){if(control.phase!=='ready'||control.activeProduction||!control.currentResultId)throw Error('CHANGE_STALE')}
// A draft freezes provenance only. It grants no execution permission or budget reservation.
export async function prepareMusicChangeDraft(projects:ProjectStore,owner:string,projectId:string,untrusted:unknown,root:string):Promise<ObjectRef>{
 const parsed=MusicProposal.safeParse(untrusted);if(!parsed.success)throw Error('CHANGE_PLAN_INVALID');const proposal=parsed.data;
 const control=await projects.access(owner,projectId);assertReady(control);
 const message=await sourceMessage(projects,control,proposal.sourceMessageId);
 if(message.target!.artifactId!==proposal.targetArtifactId||message.target!.revisionId!==proposal.revisionId)throw Error('CHANGE_AUTHORIZATION_REQUIRED');
 const baseline=await exportBaseline(projects,owner,projectId,proposal.targetArtifactId,root);
 if(baseline.result.resultId!==control.currentResultId||baseline.result.revisionId!==proposal.revisionId)throw Error('CHANGE_STALE');
 const draft=Draft.parse({...proposal,projectId,ownerKeyHash:owner,candidateRisk:'safe_direct',scope:'entire_film',authorizationSource:'explicit_message',sourceMessageSha256:canonicalHash(message),baseline:{resultId:baseline.result.resultId,resultHash:baseline.resultHash,bundleHash:baseline.bundle.bundleHash,consentEpoch:control.consentEpoch,briefVersion:control.briefVersion},requiredQualityChecks:baseline.result.qualityPolicy.requiredRules,budgetReservation:null,execution:'not_started'});
 const key=`projects/${projectId}/change-drafts/${proposal.changePlanId}`,saved=await createOrRead(projects.store,key,draft);
 if(canonicalHash(saved)!==canonicalHash(draft))throw Error('IDEMPOTENCY_CONFLICT');
 const ref={key,sha256:canonicalHash(saved),bytes:Buffer.byteLength(canonicalJson(saved)),mime:'application/json'};
 await revalidateMusicChangeDraft(projects,owner,projectId,ref,root);return ref;
}
export async function revalidateMusicChangeDraft(projects:ProjectStore,owner:string,projectId:string,untrustedRef:ObjectRef,root:string):Promise<MusicChangeDraft>{
 const control=await projects.access(owner,projectId);assertReady(control);
 const ref=ObjectRefSchema.parse(untrustedRef),draft=Draft.parse(await verifiedRead(projects,ref,`projects/${projectId}/change-drafts/`));
 if(draft.projectId!==projectId||draft.ownerKeyHash!==owner||ref.key!==`projects/${projectId}/change-drafts/${draft.changePlanId}`||draft.baseline.consentEpoch!==control.consentEpoch||draft.baseline.briefVersion!==control.briefVersion||draft.baseline.resultId!==control.currentResultId)throw Error('CHANGE_STALE');
 const message=await sourceMessage(projects,control,draft.sourceMessageId);
 if(canonicalHash(message)!==draft.sourceMessageSha256||message.target!.artifactId!==draft.targetArtifactId||message.target!.revisionId!==draft.revisionId)throw Error('CHANGE_SOURCE_INVALID');
 const baseline=await exportBaseline(projects,owner,projectId,draft.targetArtifactId,root);
 if(baseline.resultHash!==draft.baseline.resultHash||baseline.bundle.bundleHash!==draft.baseline.bundleHash||baseline.result.revisionId!==draft.revisionId)throw Error('CHANGE_STALE');
 const latest=await projects.access(owner,projectId);assertReady(latest);
 if(latest.consentEpoch!==control.consentEpoch||latest.briefVersion!==control.briefVersion||latest.currentResultId!==control.currentResultId||latest.messagesIndexRef.sha256!==control.messagesIndexRef.sha256)throw Error('CHANGE_STALE');return draft;
}
