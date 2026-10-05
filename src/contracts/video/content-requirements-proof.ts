import {z} from 'zod';
import {ObjectRefSchema,UnderstandingSchema,type ObjectRef} from './domain';
import {requirementsContext,guardRequirementsProposal,guardRequirementsAudit,approvedRequirements,type RequirementsContext} from './content-requirements';
import type {AtomicStore} from '@/services/video/storage/atomic-store';
import {readNarrationJson} from '@/services/video/audio/narration-package';
import {canonicalHash} from '@/services/video/domain/hash';
export const ContentRequirementsProofSchema=z.strictObject({schemaVersion:z.literal(1),operationId:z.uuid(),consentEpoch:z.number().int().nonnegative(),understandingRef:ObjectRefSchema,contextRef:ObjectRefSchema,proposalRef:ObjectRefSchema,auditRef:ObjectRefSchema,requirements:z.array(z.strictObject({factId:z.string().min(1),representation:z.enum(['literal','semantic']),exactText:z.array(z.string().min(1))})).max(100),scope:z.literal('source_requirements_only'),productionApproval:z.literal(false)});
/** Verifies complete source lineage without granting consent or writing state. */
export async function verifyContentRequirementsProof(store:AtomicStore,projectId:string,revisionId:string,raw:unknown,expected:Omit<RequirementsContext,'contextSha256'>){
 if(![projectId,revisionId].every(id=>z.uuid().safeParse(id).success))throw Error('VALIDATION_FAILED');
 const p=`projects/${projectId}/revisions/${revisionId}/`,record=ContentRequirementsProofSchema.parse(raw),context=requirementsContext(expected);
 if(record.understandingRef.sha256!==context.understandingSha256)throw Error('CONTENT_REQUIREMENTS_BASELINE_CHANGED');
 const understanding=UnderstandingSchema.parse(await readNarrationJson(store,record.understandingRef,`projects/${projectId}/understanding/`));
 if(understanding.unresolvedConflictIds.length||canonicalHash(understanding.facts.filter(f=>['provided','confirmed'].includes(f.status)))!==canonicalHash(context.facts))throw Error('CONTENT_REQUIREMENTS_BASELINE_CHANGED');
 const cold=await readNarrationJson(store,record.contextRef,p+'content-requirements-context/');if(canonicalHash(cold)!==canonicalHash(context))throw Error('CONTENT_REQUIREMENTS_BASELINE_CHANGED');
 const proposal=guardRequirementsProposal(await readNarrationJson(store,record.proposalRef,p+'content-requirements-proposal/'),context),audit=guardRequirementsAudit(await readNarrationJson(store,record.auditRef,p+'content-requirements-audit/'),context,proposal);
 if(canonicalHash(record.requirements)!==canonicalHash(approvedRequirements(context,proposal,audit)))throw Error('CONTENT_REQUIREMENTS_BASELINE_CHANGED');return record;
}
export async function readContentRequirementsProof(store:AtomicStore,projectId:string,revisionId:string,ref:ObjectRef,understandingRef:ObjectRef,facts:RequirementsContext['facts']){
 if(![projectId,revisionId].every(id=>z.uuid().safeParse(id).success))throw Error('VALIDATION_FAILED');
 const raw=await readNarrationJson(store,ref,`projects/${projectId}/revisions/${revisionId}/content-requirements-proof/`),record=ContentRequirementsProofSchema.parse(raw);
 if(canonicalHash(record.understandingRef)!==canonicalHash(understandingRef))throw Error('CONTENT_REQUIREMENTS_BASELINE_CHANGED');
 return verifyContentRequirementsProof(store,projectId,revisionId,record,{understandingSha256:understandingRef.sha256,facts});
}
