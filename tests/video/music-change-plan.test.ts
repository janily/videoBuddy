import {afterEach,beforeEach,expect,it} from 'vitest';
import {mkdtemp,mkdir,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {FileStore} from '@/services/video/storage/file-store';
import {ProjectStore} from '@/services/video/storage/project-store';
import {updateJson} from '@/services/video/storage/atomic-store';
import type {ProjectControl,ArchivedMessage} from '@/contracts/video/project';
import {mandatoryDeliveryRules} from '@/services/video/quality/delivery';
import {seedPreviewBundle} from './fixtures/preview-package';
import {prepareMusicChangeDraft,revalidateMusicChangeDraft} from '@/services/video/revisions/music-change-plan';
let root:string;const owner='a'.repeat(64);
beforeEach(async()=>{root=await mkdtemp(join(tmpdir(),'vb-change-draft-'))});afterEach(async()=>{await rm(root,{recursive:true,force:true})});
async function fixture(){
 const store=new FileStore(root),projects=new ProjectStore(store),{projectId}=await projects.create(owner,{schemaVersion:5,clientCommandId:randomUUID(),clientCreateId:randomUUID()}),artifactId=randomUUID(),revisionId=randomUUID(),resultId=randomUUID();
 const bundle=await seedPreviewBundle(projects,{projectId,revisionId,durationSec:20,briefVersion:1,previewArtifactSha256:'b'.repeat(64)});await store.create(`projects/${projectId}/previews/${bundle.previewId}/manifest`,bundle);
 const bytes=Buffer.from('change authorization protocol fixture; not qualified media'),sha256=createHash('sha256').update(bytes).digest('hex'),key=`projects/${projectId}/artifacts/${artifactId}/files/final.mp4`;
 await mkdir(join(root,'objects',`projects/${projectId}/artifacts/${artifactId}/files`),{recursive:true});await writeFile(join(root,'objects',key),bytes);
 await store.create(`projects/${projectId}/artifacts/${artifactId}/manifest`,{id:artifactId,revisionId,objectRef:{key,sha256,bytes:bytes.length,mime:'video/mp4'},qaPassed:true,uploaded:true,filename:'final.mp4'});
 const manifest={resultId,artifactId,revisionId,previewId:bundle.previewId,approvalId:randomUUID(),bundleHash:bundle.bundleHash,mp4Sha256:sha256,mp4Bytes:bytes.length,qualityPolicy:{schemaVersion:1,audioIntent:'silent',captions:false,requiredRules:[...mandatoryDeliveryRules]},qualityChecks:[...mandatoryDeliveryRules,'decoded_silence'].map(ruleId=>({ruleId,result:'pass',severity:'blocking',evidenceRefs:['protocol-fixture-not-real-QA']})),createdAt:new Date().toISOString()};
 await store.create(`projects/${projectId}/results/${resultId}/manifest`,manifest);await updateJson(store,`projects/${projectId}/control`,(c:ProjectControl)=>({...c,phase:'ready' as const,currentResultId:resultId}));
 const message:ArchivedMessage={id:randomUUID(),clientMessageId:randomUUID(),operationId:randomUUID(),ordinal:1,role:'user',text:'这版音乐调小一点',target:{artifactId,revisionId,sourceTimeMs:null},status:'completed',contentVersion:1};await projects.archiveMessage(projectId,message);
 const proposal={schemaVersion:5 as const,changePlanId:randomUUID(),sourceMessageId:message.id,targetArtifactId:artifactId,revisionId,operations:[{field:'musicGainDb' as const,value:-3}],factsChanged:false,reason:'降低整片配乐，保留旁白和事实'};
 return{store,projects,projectId,artifactId,revisionId,resultId,message,proposal,manifest,key,bytes};
}
it('T13 persists a source-bound music draft and cold revalidation never reserves or executes',async()=>{
 const f=await fixture(),before=await f.projects.access(owner,f.projectId),ref=await prepareMusicChangeDraft(f.projects,owner,f.projectId,f.proposal,root);
 const draft=await revalidateMusicChangeDraft(new ProjectStore(new FileStore(root)),owner,f.projectId,ref,root);expect(draft).toMatchObject({candidateRisk:'safe_direct',scope:'entire_film',authorizationSource:'explicit_message',sourceMessageId:f.message.id,execution:'not_started',budgetReservation:null,baseline:{resultId:f.resultId,consentEpoch:before.consentEpoch,briefVersion:before.briefVersion}});
 expect(await prepareMusicChangeDraft(f.projects,owner,f.projectId,f.proposal,root)).toEqual(ref);expect(await f.projects.access(owner,f.projectId)).toEqual(before);
 await expect(prepareMusicChangeDraft(f.projects,owner,f.projectId,{...f.proposal,operations:[{field:'musicGainDb',value:-4}]},root)).rejects.toThrow('IDEMPOTENCY_CONFLICT');
});
it('T13 refuses foreign owners, assistant suggestions, missing targets and local playhead scopes',async()=>{
 const f=await fixture(),original=f.message;await expect(prepareMusicChangeDraft(f.projects,'b'.repeat(64),f.projectId,f.proposal,root)).rejects.toThrow('ACCESS_NOT_FOUND');
 for(const change of [{role:'assistant' as const},{target:null},{target:{artifactId:randomUUID(),revisionId:f.revisionId,sourceTimeMs:null}},{target:{artifactId:f.artifactId,revisionId:f.revisionId,sourceTimeMs:1000}}]){
  f.message={...original,...change,contentVersion:f.message.contentVersion+1};await f.projects.archiveMessage(f.projectId,f.message);
  await expect(prepareMusicChangeDraft(f.projects,owner,f.projectId,f.proposal,root)).rejects.toThrow('CHANGE_AUTHORIZATION_REQUIRED');
 }
});
it('T13 rejects malformed proposals, facts changes and broader changes without creating a draft',async()=>{
 const f=await fixture();for(const proposal of [{...f.proposal,factsChanged:true},{...f.proposal,operations:[{field:'color',value:'red'}]},{...f.proposal,operations:[{field:'musicGainDb',value:-7}]},{...f.proposal,operations:[{field:'musicGainDb',value:-3},{field:'musicGainDb',value:-4}]},{...f.proposal,authorization:'explicit_message'}])await expect(prepareMusicChangeDraft(f.projects,owner,f.projectId,proposal,root)).rejects.toThrow('CHANGE_PLAN_INVALID');
});
it('T13 cold drafts are invalid after result replacement, cancellation, source revision or source bytes change',async()=>{
 const f=await fixture(),ref=await prepareMusicChangeDraft(f.projects,owner,f.projectId,f.proposal,root),baseline=await f.projects.access(owner,f.projectId);
 for(const patch of [{consentEpoch:baseline.consentEpoch+1},{briefVersion:baseline.briefVersion+1},{currentResultId:randomUUID()},{activeProduction:randomUUID()}]){await updateJson(f.store,`projects/${f.projectId}/control`,()=>({...baseline,...patch}));await expect(revalidateMusicChangeDraft(f.projects,owner,f.projectId,ref,root)).rejects.toThrow('CHANGE_STALE');}
 await updateJson(f.store,`projects/${f.projectId}/control`,()=>baseline);const entries=await f.projects.index.all(baseline.messagesIndexRef),entry=entries.find(e=>e.id===f.message.id)!;const old=await f.store.readFresh<ArchivedMessage>(entry.ref.key);await f.store.cas(entry.ref.key,old.etag,{...old.value,text:'changed stored source'});
 await expect(revalidateMusicChangeDraft(f.projects,owner,f.projectId,ref,root)).rejects.toThrow('CHANGE_SOURCE_INVALID');
});
it('T13 verifies actual baseline bytes and complete quality records before saving a draft',async()=>{
 const f=await fixture();await writeFile(join(root,'objects',f.key),Buffer.from('tampered'));
 await expect(prepareMusicChangeDraft(f.projects,owner,f.projectId,f.proposal,root)).rejects.toThrow('ARTIFACT_INVALID');
 await writeFile(join(root,'objects',f.key),f.bytes);
 const resultKey=`projects/${f.projectId}/results/${f.resultId}/manifest`,old=await f.store.readFresh(resultKey);await f.store.cas(resultKey,old.etag,{...f.manifest,qualityChecks:[]});
 await expect(prepareMusicChangeDraft(f.projects,owner,f.projectId,f.proposal,root)).rejects.toThrow('QUALITY_BLOCKED');
});
it('T13 revalidation rejects cancellation that occurs while reading baseline media',async()=>{
 const f=await fixture(),ref=await prepareMusicChangeDraft(f.projects,owner,f.projectId,f.proposal,root);let changed=false;
 const store={readFresh:async<T>(key:string)=>{if(!changed&&key.includes('/previews/')&&key.endsWith('/manifest')){changed=true;await updateJson(f.store,`projects/${f.projectId}/control`,(c:ProjectControl)=>({...c,consentEpoch:c.consentEpoch+1}))}return f.store.readFresh<T>(key)},create:f.store.create.bind(f.store),cas:f.store.cas.bind(f.store)};
 await expect(revalidateMusicChangeDraft(new ProjectStore(store),owner,f.projectId,ref,root)).rejects.toThrow('CHANGE_STALE');expect(changed).toBe(true);
});
it('T13 preserves relative gain intent separately from absolute master gain and rejects a zero reduction',async()=>{
 const f=await fixture(),proposal={...f.proposal,operations:[{field:'musicGainDb',value:-3,valueMode:'relative'}]};
 const ref=await prepareMusicChangeDraft(f.projects,owner,f.projectId,proposal,root),draft=await revalidateMusicChangeDraft(f.projects,owner,f.projectId,ref,root);expect(draft.operations[0]).toEqual({field:'musicGainDb',value:-3,valueMode:'relative'});
 await expect(prepareMusicChangeDraft(f.projects,owner,f.projectId,{...proposal,changePlanId:crypto.randomUUID(),operations:[{field:'musicGainDb',value:0,valueMode:'relative'}]},root)).rejects.toThrow('CHANGE_PLAN_INVALID');
});
