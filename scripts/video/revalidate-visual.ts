import {readFile,writeFile,realpath} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {join,resolve,relative,isAbsolute} from 'node:path';
import {CompleteVisualShotSchema,guardVisualShot} from '../../src/contracts/video/visual-shot';
import type {ProjectControl} from '../../src/contracts/video/project';
import type {Understanding,ObjectRef} from '../../src/contracts/video/domain';
import {FileStore} from '../../src/services/video/storage/file-store';
import {ProjectStore} from '../../src/services/video/storage/project-store';
import {canonicalHash} from '../../src/services/video/domain/hash';
import {updateJson} from '../../src/services/video/storage/atomic-store';
import {revisionSeed} from '../../src/services/video/timeline/seed';
import {prepareVisualShotStage} from '../../src/services/video/preview/visual-stage';
import {TimingDraftSchema} from '../../src/services/video/preview/timing-draft';
import {assertPreviewProductionFence} from '../../src/services/video/preview/fence';
import {probeEnvironment} from './helpers/real-probe';

// Explicit local reconciliation of already returned provider bytes after a validator fix.
// No model request, budget refund, source edit, user approval or publish occurs.
async function main(){
 if(!process.argv.includes('--revalidate'))throw Error('LOCAL_REVALIDATION_OPT_IN_REQUIRED');
 const creation=JSON.parse(await readFile('docs/engineering/evidence/real-creation-no-voice-probe.json','utf8')),visual=JSON.parse(await readFile('docs/engineering/evidence/real-visual-probe.json','utf8'));
 const root=await realpath(creation.root),rel=relative(await realpath(resolve('.video-local/real-creation')),root);
 if(!rel||rel.startsWith('..')||isAbsolute(rel)||root!==visual.root||visual.requests.length!==4)throw Error('REVALIDATION_BASELINE_REQUIRED');
 const projects=new ProjectStore(new FileStore(root)),{projectId,revisionId,operationId}=creation.stages.project,prefix='projects/'+projectId,env=probeEnvironment(root),control=(await projects.store.readFresh<ProjectControl>(prefix+'/control')).value;
 assertPreviewProductionFence(control,projectId,operationId,0);
 const understanding=(await projects.store.readFresh<Understanding>(control.understandingRef.key)).value,treatmentRef=creation.stages.treatment.treatmentRef as ObjectRef,treatment=(await projects.store.readFresh(treatmentRef.key)).value;
 const timingRef=creation.stages.timing.draftRef as ObjectRef,timing=TimingDraftSchema.parse((await projects.store.readFresh(timingRef.key)).value);
 if(canonicalHash(timing)!==timingRef.sha256||canonicalHash(treatment)!==treatmentRef.sha256||canonicalHash(understanding)!==control.understandingRef.sha256)throw Error('REVALIDATION_BASELINE_CHANGED');
 const savedFetch=globalThis.fetch;globalThis.fetch=async()=>{throw Error('REVALIDATION_NETWORK_FORBIDDEN')};
 const repaired:unknown[]=[];
 try{
  for(const request of visual.requests){
   if(request.status!==200||!/^[a-f0-9]{64}$/.test(request.responseSha256)||request.responseFile!=='model-diagnostics/'+request.responseSha256+'.json')throw Error('REVALIDATION_RECEIPT_INVALID');
   const raw=await readFile(join(root,request.responseFile));
   if(createHash('sha256').update(raw).digest('hex')!==request.responseSha256)throw Error('REVALIDATION_RECEIPT_CHANGED');
   const body=JSON.parse(raw.toString('utf8'));let text=body.choices?.[0]?.message?.content;
   if(typeof text!=='string')throw Error('REVALIDATION_RECEIPT_INVALID');const fence=String.fromCharCode(96).repeat(3);text=text.trim();if(text.startsWith(fence)){text=text.slice(fence.length).replace(/^json\s*/,'');if(!text.endsWith(fence))throw Error('REVALIDATION_RECEIPT_INVALID');text=text.slice(0,-fence.length)}
   const candidate=CompleteVisualShotSchema.parse(JSON.parse(text)),output=guardVisualShot(candidate,understanding,treatment,timing,timingRef.sha256,revisionSeed(projectId,revisionId)),shotKey=canonicalHash({shotId:output.shotId});
   const key=prefix+'/operations/'+operationId+'/effects/visual/'+revisionId+'/'+shotKey,current=await projects.store.readFresh<{status:string;attemptId:string;output?:unknown;receiptRef?:ObjectRef}>(key);
   const latest=(await projects.store.readFresh<ProjectControl>(prefix+'/control')).value;assertPreviewProductionFence(latest,projectId,operationId,0,{briefVersion:control.briefVersion,understandingRef:control.understandingRef});
   if(current.value.status==='completed'){if(canonicalHash(current.value.output)!==canonicalHash(output))throw Error('REVALIDATION_EFFECT_CHANGED')}
   else{
    if(current.value.status!=='started')throw Error('REVALIDATION_EFFECT_CHANGED');
    const receiptRef=await projects.index.immutable(prefix+'/revisions/'+revisionId+'/revalidated-visual-receipts',{schemaVersion:1,reason:'validator false positive for parsed JavaScript comments',responseSha256:request.responseSha256,providerStatus:200,usage:request.usage,outputSha256:canonicalHash(output),attemptId:current.value.attemptId,treatmentSha256:treatmentRef.sha256,timingSha256:timingRef.sha256,networkCalls:0});
    await updateJson(projects.store,key,value=>{const effect=value as typeof current.value;if(effect.status!=='started'||effect.attemptId!==current.value.attemptId)throw Error('REVALIDATION_EFFECT_CHANGED');return{...effect,status:'completed',output,receiptRef}});
   }
   const record=await prepareVisualShotStage(projects,projectId,revisionId,operationId,0,treatmentRef,output.shotId,{root,env});
   repaired.push({shotId:output.shotId,sourceRef:record.sourceRef,responseSha256:request.responseSha256,status:'static_pass'});
  }
 }finally{globalThis.fetch=savedFetch}
 const evidence={executedAt:new Date().toISOString(),root,projectId,revisionId,operationId,actualModelResponsesReused:true,additionalModelCalls:0,repaired,limits:'Explicit local repair of known HTTP200 response after the JS-comment validator bug. Raw response SHA, frozen input hashes, revision seed and active operation are checked; three started paid effects receive immutable repair receipts. No source change, model retry, rendering, approval or publication.'};
 await writeFile('docs/engineering/evidence/real-visual-revalidation.json',JSON.stringify(evidence,null,2)+'\n');console.log(JSON.stringify({status:'pass',additionalModelCalls:0,shots:repaired.length}));
}
main().catch(error=>{console.error(JSON.stringify({status:'fail',errorName:error?.name||'Error',errorCode:String(error?.message||'REVALIDATION_FAILED').replaceAll(process.env.MODEL_API_KEY||'missing-key','[redacted]').slice(0,300)}));process.exitCode=1});
