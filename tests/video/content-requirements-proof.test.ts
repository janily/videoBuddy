import {it,expect} from 'vitest';
import {rm} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {seedApprovedProject} from './fixtures/approved-project';
import {requirementsContext} from '@/contracts/video/content-requirements';
import {readContentRequirementsProof} from '@/contracts/video/content-requirements-proof';
import {canonicalHash} from '@/services/video/domain/hash';
import type {FilmSpec} from '@/contracts/video/film';
import type {Understanding} from '@/contracts/video/domain';
import {loadVerifiedFilmPackage} from '@/contracts/video/film-package';

// Real immutable JSON graph and FileStore; classification fixtures are protocol
// inputs and do not claim independent model judgement or production consent.
async function proof(){
 const f=await seedApprovedProject(),spec=(await f.projects.store.readFresh<FilmSpec>(f.bundle.filmSpecRef.key)).value,u=(await f.projects.store.readFresh<Understanding>(spec.understandingRef.key)).value;
 const p=`projects/${f.projectId}/revisions/${f.bundle.revisionId}/`,context=requirementsContext({understandingSha256:spec.understandingRef.sha256,facts:u.facts.filter(f=>['provided','confirmed'].includes(f.status))});
 const proposal={schemaVersion:1,contextSha256:context.contextSha256,facts:context.facts.map(f=>({factId:f.id,segments:[{sourceText:f.text,kind:'literal',reason:'本地合同样本，完整字面保留。'}]}))};
 const audit={schemaVersion:1,contextSha256:context.contextSha256,proposalSha256:canonicalHash(proposal),facts:proposal.facts.map(f=>({factId:f.factId,segments:f.segments.map(s=>({...s,result:'accept'}))}))};
 const record={schemaVersion:1,operationId:randomUUID(),consentEpoch:0,understandingRef:spec.understandingRef,contextRef:await f.projects.index.immutable(p+'content-requirements-context',context),proposalRef:await f.projects.index.immutable(p+'content-requirements-proposal',proposal),auditRef:await f.projects.index.immutable(p+'content-requirements-audit',audit),requirements:context.facts.map(f=>({factId:f.id,representation:'literal',exactText:[f.text]})),scope:'source_requirements_only',productionApproval:false};
 const ref=await f.projects.index.immutable(p+'content-requirements-proof',record);return{...f,spec,context,record,ref,p};
}
it('reads an immutable full source proof without any mutable stage or writes',async()=>{
 const f=await proof();try{
 f.projects.store.create=async()=>{throw Error('WRITE_FORBIDDEN')};f.projects.store.cas=async()=>{throw Error('WRITE_FORBIDDEN')};
 const cold=await readContentRequirementsProof(f.projects.store,f.projectId,f.bundle.revisionId,f.ref,f.spec.understandingRef,f.context.facts);
 expect(cold).toMatchObject({requirements:[{factId:f.context.facts[0].id,representation:'literal',exactText:['活动在十月八日开始']}],productionApproval:false});
 }finally{await rm(f.root,{recursive:true,force:true})}
});
it('rejects proof substitution, changed original facts, tampered audit and forged derived requirements',async()=>{
 const f=await proof();try{
 await expect(readContentRequirementsProof(f.projects.store,randomUUID(),f.bundle.revisionId,f.ref,f.spec.understandingRef,f.context.facts)).rejects.toThrow();
 await expect(readContentRequirementsProof(f.projects.store,f.projectId,f.bundle.revisionId,f.ref,{...f.spec.understandingRef,bytes:f.spec.understandingRef.bytes+1},f.context.facts)).rejects.toThrow('CONTENT_REQUIREMENTS_BASELINE_CHANGED');
 await expect(readContentRequirementsProof(f.projects.store,f.projectId,f.bundle.revisionId,f.ref,f.spec.understandingRef,[{...f.context.facts[0],text:'Different original source'}])).rejects.toThrow('CONTENT_REQUIREMENTS_BASELINE_CHANGED');
 const forged=await f.projects.index.immutable(f.p+'content-requirements-proof',{...f.record,requirements:f.record.requirements.map(r=>({...r,representation:'semantic',exactText:[]}))});
 await expect(readContentRequirementsProof(f.projects.store,f.projectId,f.bundle.revisionId,forged,f.spec.understandingRef,f.context.facts)).rejects.toThrow('CONTENT_REQUIREMENTS_BASELINE_CHANGED');
 const old=await f.projects.store.readFresh(f.record.auditRef.key);await f.projects.store.cas(f.record.auditRef.key,old.etag,{...old.value as object,proposalSha256:'0'.repeat(64)});
 await expect(readContentRequirementsProof(f.projects.store,f.projectId,f.bundle.revisionId,f.ref,f.spec.understandingRef,f.context.facts)).rejects.toThrow();
 }finally{await rm(f.root,{recursive:true,force:true})}
});
it('includes the source proof in a versioned frozen facts graph while preserving historical v1 packages',async()=>{
 const f=await proof();try{
 const old=await loadVerifiedFilmPackage(f.projects.store,f.spec);expect(old.facts.schemaVersion).toBe(1);
 const factsRef=await f.projects.index.immutable(f.p+'facts',{schemaVersion:2,facts:f.context.facts,contentRequirementsRef:f.ref});
 const frozen=await loadVerifiedFilmPackage(f.projects.store,{...f.spec,factsRef});
 expect(frozen).toMatchObject({facts:{schemaVersion:2},contentRequirements:{requirements:[{representation:'literal',exactText:['活动在十月八日开始']}]}});
 const before=await f.projects.store.readFresh(f.spec.factsRef.key);expect(canonicalHash(before.value)).toBe(f.spec.factsRef.sha256);
 }finally{await rm(f.root,{recursive:true,force:true})}
});
