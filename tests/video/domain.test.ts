import { describe,it,expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { validateCommand } from '@/contracts/video/commands';
import { assertPreviewBaseline } from '@/services/video/domain/preview-policy';
import { transitionOperation, applyBriefChange } from '@/services/video/domain/state-machine';
import { canonicalHash } from '@/services/video/domain/hash';
const fixture=(name:string)=>JSON.parse(readFileSync(`docs/hand-off/videobuddy-v5.1/examples/${name}.json`,'utf8'));
const approval=fixture('approve-preview');
const preview={...approval, briefVersion:approval.expectedBriefVersion, expiresAt:'2030-01-01T00:00:00Z'};
const control={briefVersion:approval.expectedBriefVersion,controlVersion:4,inputPending:false,previewState:'ready' as const,currentPreviewId:approval.previewId,consentEpoch:0};
describe('T01 command boundary',()=>{
 it.each(['create-project','send-message','send-attachment-only','approve-preview','reserve-upload','cancel-production'])('accepts approved %s fixture',name=>{
  const names:Record<string,string>={'create-project':'CreateProjectRequest','send-message':'SendMessageRequest','send-attachment-only':'SendMessageRequest','approve-preview':'ApprovePreviewRequest','reserve-upload':'ReserveUploadRequest','cancel-production':'CancelOperationRequest'};
  expect(validateCommand(names[name],fixture(name))).toEqual(fixture(name));
 });
 it.each([['invalid-duration','UpdatePreferencesRequest'],['invalid-empty-message','SendMessageRequest'],['invalid-approval-extra-field','ApprovePreviewRequest']])('rejects %s', (name,kind)=>expect(()=>validateCommand(kind,fixture(name))).toThrow('VALIDATION_FAILED'));
 it('rejects unknown command shapes and client owner injection',()=>{
  expect(()=>validateCommand('NotACommand',{})).toThrow();
  expect(()=>validateCommand('SendMessageRequest',{...fixture('send-message'),owner:'other'})).toThrow('VALIDATION_FAILED');
 });
});
describe('T01 semantic preview approval',()=>{
 it('AT-004/063 control-only chat does not stale a semantic approval',()=>{
  const changed=applyBriefChange(control,false); expect(changed.briefVersion).toBe(control.briefVersion);
  expect(()=>assertPreviewBaseline({...changed,controlVersion:99},preview,approval,Date.parse('2026-10-02T00:00:00Z'))).not.toThrow();
 });
 it('AT-005 date correction rejects old approval',()=>expect(()=>assertPreviewBaseline(applyBriefChange(control,true),preview,approval)).toThrow('PREVIEW_STALE'));
 it('blocks pending materials rather than silently approving',()=>expect(()=>assertPreviewBaseline({...control,inputPending:true},preview,approval)).toThrow('INPUT_PENDING'));
 it('blocks expired previews',()=>expect(()=>assertPreviewBaseline(control,{...preview,expiresAt:'2020-01-01T00:00:00Z'},approval)).toThrow('PREVIEW_STALE'));
 it('does not substitute a newly generated bundle on retry',()=>expect(()=>assertPreviewBaseline(control,{...preview,bundleHash:'f'.repeat(64)},approval)).toThrow('PREVIEW_STALE'));
 it('AT-006 a cancelled operation cannot be resurrected',()=>expect(()=>transitionOperation('cancelled','succeeded')).toThrow('INVALID_TRANSITION'));
 it('cancellation does not retroactively remove a completed result',()=>expect(()=>transitionOperation('succeeded','cancelled')).toThrow('INVALID_TRANSITION'));
 it('canonical hashes ignore key order while retaining media dependencies',()=>{
  expect(canonicalHash({b:2,a:1})).toBe(canonicalHash({a:1,b:2}));
  expect(canonicalHash({audio:'a'})).not.toBe(canonicalHash({audio:'b'}));
 });
});
