import {describe,it,expect} from 'vitest';
import {canonicalHash} from '@/services/video/domain/hash';
import {auditLegacyCounter,recoverReservationCost} from '@/services/video/budget/legacy-audit';
const projectId='project';
function fixture(){const cost={inputTokens:20,outputTokens:10},stage='call',id=canonicalHash({projectId,stage});return {counter:{calls:1,inputTokens:20,outputTokens:10,reservations:{[id]:canonicalHash(cost)}},rows:[{id,stage,cost,day:'2026-10-03',usage:{inputTokens:3,outputTokens:12},evidence:'raw_response' as const,responseSha256:'a'.repeat(64)}]}}
describe('read-only legacy accounting audit',()=>{
 it('recovers only an exact reservation digest within the bounded numeric search',()=>{
  const cost={inputTokens:7,outputTokens:10},hash=canonicalHash(cost);
  expect(recoverReservationCost(hash,10,10)).toEqual(cost);
  for(const [cap,bound] of [[11,10],[10,6],[10,250001],[0,10]])expect(()=>recoverReservationCost(hash,cap,bound)).toThrow('LEGACY_AUDIT_INVALID');
 });
 it('never treats complete project evidence as deployment migration authority',()=>{
  const f=fixture();const result=auditLegacyCounter(projectId,f.counter,[{...f.rows[0],usage:{inputTokens:3,outputTokens:5}}]);
  expect(result).toMatchObject({rawResponses:1,reportedOnlyResponses:0,overrunCalls:0,blockers:[],migrationReady:false});
 });
 it('retains all reservations and unused estimates, adds overruns and never authorizes generation',()=>{
  const f=fixture(),before=structuredClone(f);const result=auditLegacyCounter(projectId,f.counter,f.rows);
  expect(result).toMatchObject({reservedCalls:1,actualUsage:{inputTokens:3,outputTokens:12},conservativeAfterAccounting:{calls:1,inputTokens:20,outputTokens:12},overrunCalls:1,overrunOutputTokens:2,migrationReady:false,blockers:['MODEL_BUDGET_OVERRUN']});expect(f).toEqual(before);
 });
 it('reports missing raw evidence without claiming the reported usage is provider-verified',()=>{
  const f=fixture();const result=auditLegacyCounter(projectId,f.counter,[{...f.rows[0],usage:{inputTokens:3,outputTokens:5},evidence:'historical_report',responseSha256:undefined}]);
  expect(result).toMatchObject({rawResponses:0,reportedOnlyResponses:1,migrationReady:false,blockers:['LEGACY_RAW_RESPONSE_MISSING']});
 });
 it('rejects incomplete, duplicate, misbound or inconsistent evidence',()=>{
  const f=fixture();for(const rows of [[],[...f.rows,...f.rows],[{...f.rows[0],stage:'other'}],[{...f.rows[0],cost:{inputTokens:21,outputTokens:10}}]])expect(()=>auditLegacyCounter(projectId,f.counter,rows)).toThrow('LEGACY_AUDIT_INVALID');
  expect(()=>auditLegacyCounter(projectId,{...f.counter,inputTokens:21},f.rows)).toThrow('LEGACY_AUDIT_INVALID');
 });
});
