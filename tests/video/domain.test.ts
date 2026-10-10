import { describe,it,expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { validateCommand } from '@/contracts/video/commands';
import { transitionOperation, applyBriefChange } from '@/services/video/domain/state-machine';
import { canonicalHash } from '@/services/video/domain/hash';
const fixture=(name:string)=>JSON.parse(readFileSync(`docs/hand-off/videobuddy-v5.1/examples/${name}.json`,'utf8'));
describe('T01 command boundary',()=>{
 it.each(['create-project','send-message','send-attachment-only','reserve-upload','cancel-production'])('accepts approved %s fixture',name=>{
  const names:Record<string,string>={'create-project':'CreateProjectRequest','send-message':'SendMessageRequest','send-attachment-only':'SendMessageRequest','reserve-upload':'ReserveUploadRequest','cancel-production':'CancelOperationRequest'};
  const input=fixture(name);if(name==='create-project')input.preferences.durationSec=30;expect(validateCommand(names[name],input)).toEqual(input);
 });
 it.each([['invalid-duration','UpdatePreferencesRequest'],['invalid-empty-message','SendMessageRequest'],['invalid-approval-extra-field','ApprovePreviewRequest']])('rejects %s', (name,kind)=>expect(()=>validateCommand(kind,fixture(name))).toThrow('VALIDATION_FAILED'));
 it('rejects unknown command shapes and client owner injection',()=>{
  expect(()=>validateCommand('NotACommand',{})).toThrow();
  expect(()=>validateCommand('SendMessageRequest',{...fixture('send-message'),owner:'other'})).toThrow('VALIDATION_FAILED');
 });
});
describe('operation and brief invariants',()=>{
 it('increments only the semantic brief version',()=>{const c={briefVersion:1,controlVersion:1};expect(applyBriefChange(c,false).briefVersion).toBe(1);expect(applyBriefChange(c,true).briefVersion).toBe(2)});
 it('AT-006 a cancelled operation cannot be resurrected',()=>expect(()=>transitionOperation('cancelled','succeeded')).toThrow('INVALID_TRANSITION'));
 it('cancellation does not retroactively remove a completed result',()=>expect(()=>transitionOperation('succeeded','cancelled')).toThrow('INVALID_TRANSITION'));
 it('canonical hashes ignore key order while retaining media dependencies',()=>{
  expect(canonicalHash({b:2,a:1})).toBe(canonicalHash({a:1,b:2}));
  expect(canonicalHash({audio:'a'})).not.toBe(canonicalHash({audio:'b'}));
 });
});
