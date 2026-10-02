export interface QualityCheck{ruleId:string;result:'pass'|'fail'|'not_checked'|'not_applicable'|'waived';severity:'blocking'|'warning';evidenceRefs:string[];reason?:string;waiverActor?:string}
export function qualityGate(checks:QualityCheck[],allowedNotApplicable:string[]=[],requiredRules=['decode']){
 if(requiredRules.some(id=>!checks.some(c=>c.ruleId===id)))throw Error('QUALITY_BLOCKED');
 for(const check of checks){if(check.severity!=='blocking')continue;
  if(check.result==='pass'&&check.evidenceRefs.length)continue;
  if(check.result==='not_applicable'&&allowedNotApplicable.includes(check.ruleId)&&check.reason)continue;
  throw Error('QUALITY_BLOCKED');
 }
}
export function assertPublishable(current:{bundleHash:string;consentEpoch:number;owner:string;activeOperationId:string;deletedAt?:string},approved:{bundleHash:string;consentEpoch:number;owner:string;operationId:string}){
 if(current.deletedAt||current.consentEpoch!==approved.consentEpoch||current.owner!==approved.owner||current.activeOperationId!==approved.operationId)throw Error('PUBLISH_FENCED');if(current.bundleHash!==approved.bundleHash)throw Error('PREVIEW_STALE');
}
