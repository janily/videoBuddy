import {z} from 'zod';
import {canonicalHash} from '@/services/video/domain/hash';
const integer=z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),digest=z.string().regex(/^[a-f0-9]{64}$/);
const costSchema=z.strictObject({inputTokens:integer.positive(),outputTokens:integer.positive()});
const counterSchema=z.strictObject({calls:integer.max(64),inputTokens:integer,outputTokens:integer,reservations:z.record(digest,digest)});
const rowSchema=z.strictObject({id:digest,stage:z.string().min(1).max(400),cost:costSchema,day:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),usage:z.strictObject({inputTokens:integer,outputTokens:integer}),evidence:z.enum(['raw_response','historical_report']),responseSha256:digest.optional()}).refine(row=>row.evidence==='raw_response'?Boolean(row.responseSha256):row.responseSha256===undefined);
export type LegacyAuditRow=z.infer<typeof rowSchema>;
/** Reconstruct a small numeric reservation by exact digest, never by a guessed cost. */
export function recoverReservationCost(hash:string,outputTokens:number,inputUpperBound:number){
 if(!digest.safeParse(hash).success||!Number.isSafeInteger(outputTokens)||outputTokens<1||outputTokens>50000||!Number.isSafeInteger(inputUpperBound)||inputUpperBound<1||inputUpperBound>250000)throw Error('LEGACY_AUDIT_INVALID');
 for(let inputTokens=1;inputTokens<=inputUpperBound;inputTokens++){const cost={inputTokens,outputTokens};if(canonicalHash(cost)===hash)return cost}
 throw Error('LEGACY_AUDIT_INVALID');
}
/** Read-only project evidence; never writes accounting or releases a deployment gate. */
export function auditLegacyCounter(projectId:string,untrustedCounter:unknown,untrustedRows:unknown){
 const parsed=counterSchema.safeParse(untrustedCounter),records=z.array(rowSchema).max(64).safeParse(untrustedRows);
 if(!/^[A-Za-z0-9_-]{1,120}$/.test(projectId)||!parsed.success||!records.success)throw Error('LEGACY_AUDIT_INVALID');
 const counter=parsed.data,rows=records.data,ids=new Set<string>();let input=0,output=0,actualInput=0,actualOutput=0,extraInput=0,extraOutput=0,overrunCalls=0,rawResponses=0;
 for(const row of rows){
  if(ids.has(row.id)||row.id!==canonicalHash({projectId,stage:row.stage})||counter.reservations[row.id]!==canonicalHash(row.cost))throw Error('LEGACY_AUDIT_INVALID');ids.add(row.id);
  input+=row.cost.inputTokens;output+=row.cost.outputTokens;actualInput+=row.usage.inputTokens;actualOutput+=row.usage.outputTokens;
  extraInput+=Math.max(0,row.usage.inputTokens-row.cost.inputTokens);extraOutput+=Math.max(0,row.usage.outputTokens-row.cost.outputTokens);
  if(row.usage.inputTokens>row.cost.inputTokens||row.usage.outputTokens>row.cost.outputTokens)overrunCalls++;
  if(row.evidence==='raw_response')rawResponses++;
 }
 if(ids.size!==counter.calls||ids.size!==Object.keys(counter.reservations).length||input!==counter.inputTokens||output!==counter.outputTokens||![input,output,actualInput,actualOutput,counter.inputTokens+extraInput,counter.outputTokens+extraOutput].every(Number.isSafeInteger))throw Error('LEGACY_AUDIT_INVALID');
 const reportedOnlyResponses=rows.length-rawResponses,blockers=[] as string[];
 if(reportedOnlyResponses)blockers.push('LEGACY_RAW_RESPONSE_MISSING');if(overrunCalls)blockers.push('MODEL_BUDGET_OVERRUN');
 return{schemaVersion:1 as const,mode:'read_only_project_audit' as const,reservedCalls:counter.calls,counterSha256:canonicalHash(counter),rawResponses,reportedOnlyResponses,actualUsage:{inputTokens:actualInput,outputTokens:actualOutput},conservativeAfterAccounting:{calls:counter.calls,inputTokens:counter.inputTokens+extraInput,outputTokens:counter.outputTokens+extraOutput},overrunCalls,overrunInputTokens:extraInput,overrunOutputTokens:extraOutput,migrationReady:false as const,blockers,rows};
}
