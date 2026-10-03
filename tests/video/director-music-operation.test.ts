import {afterEach,beforeEach,it,expect} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {musicChangeProject} from './fixtures/music-change-project';
import {updateJson} from '@/services/video/storage/atomic-store';
import {FileStore} from '@/services/video/storage/file-store';
import type {ProjectControl} from '@/contracts/video/project';
import type {ObjectRef} from '@/contracts/video/domain';
import {LocalEventLog} from '@/services/video/stream/local-event-log';
import {runDirectorOperation} from '@/services/video/commands/local-director';
import {revalidateMusicChangeDraft} from '@/services/video/revisions/music-change-plan';
let root:string;const owner='a'.repeat(64),limits={projectCalls:10,projectInputTokens:1000000,projectOutputTokens:100000,dailyCalls:10};
beforeEach(async()=>{root=await mkdtemp(join(tmpdir(),'vb-director-change-'))});afterEach(async()=>{await rm(root,{recursive:true,force:true})});
async function fixture(){const f=await musicChangeProject(root,owner),operationId=f.message.operationId!;await updateJson(f.store,`projects/${f.projectId}/control`,(c:ProjectControl)=>({...c,activeConversation:operationId,ordinalReservations:{[operationId]:{user:1,assistant:2}},nextOrdinal:3}));await f.store.create(`projects/${f.projectId}/operations/${operationId}`,{id:operationId,projectId:f.projectId,commandId:crypto.randomUUID(),kind:'chat',status:'reserved',canonicalRunId:null,streamEpoch:0,fence:0});return{...f,operationId}}
it('T13 Director records its structured interpretation as the same source-bound draft without launching production',async()=>{
 const f=await fixture();let calls=0;
const decide:NonNullable<Parameters<typeof runDirectorOperation>[4]>['decide']=async(_u,_m,_max,options)=>{calls++;expect(options?.projectContext).toMatchObject({currentTurnUserMessageIds:[f.message.id],currentResult:{artifactId:f.artifactId,revisionId:f.revisionId}});return{action:'change',effect:'pending_followup',executionIntent:'classify_change',reply:'记下这版配乐的调整，视频还没有改动。',evidenceMessageIds:[f.message.id],musicChange:{sourceMessageId:f.message.id,targetArtifactId:f.artifactId,revisionId:f.revisionId,musicGainDb:-3,gainMode:'relative',requestQuote:'音乐调小一点',reason:'明确降低整片配乐'}}};
 await runDirectorOperation(f.store,new LocalEventLog(root),f.projectId,f.operationId,{decide,limits,root});
 const op=(await f.store.readFresh<{musicChangeDraftRef:ObjectRef;status:string}>(`projects/${f.projectId}/operations/${f.operationId}`)).value;expect(op.status).toBe('succeeded');expect(op.musicChangeDraftRef).toBeDefined();
 const draft=await revalidateMusicChangeDraft(f.projects,owner,f.projectId,op.musicChangeDraftRef,root);expect(draft).toMatchObject({sourceMessageId:f.message.id,operations:[{field:'musicGainDb',value:-3,valueMode:'relative'}],execution:'not_started',budgetReservation:null});
 await runDirectorOperation(new FileStore(root),new LocalEventLog(root),f.projectId,f.operationId,{decide,limits,root});expect(calls).toBe(1);expect((await f.projects.access(owner,f.projectId)).currentResultId).toBe(f.resultId);expect((await f.projects.access(owner,f.projectId)).activeProduction).toBeFalsy();
});
it('T13 cold recovery after a draft pointer fsync loses its acknowledgement reuses the same model decision and plan',async()=>{
 const f=await fixture();let calls=0,dead=false;
 const decide:NonNullable<Parameters<typeof runDirectorOperation>[4]>['decide']=async()=>{calls++;return{action:'change',effect:'pending_followup',executionIntent:'classify_change',reply:'记下调整，尚未改动视频。',evidenceMessageIds:[f.message.id],musicChange:{sourceMessageId:f.message.id,targetArtifactId:f.artifactId,revisionId:f.revisionId,musicGainDb:-3,gainMode:'relative',requestQuote:'音乐调小一点',reason:'明确降低整片配乐'}}};
 const store={listKeys:f.store.listKeys.bind(f.store),create:f.store.create.bind(f.store),readFresh:async<T>(key:string)=>{if(dead)throw Error('POWER_LOSS');return f.store.readFresh<T>(key)},cas:async<T>(key:string,etag:string,value:T)=>{if(dead)throw Error('POWER_LOSS');await f.store.cas(key,etag,value);if(key===`projects/${f.projectId}/operations/${f.operationId}`&&value&&typeof value==='object'&&'musicChangeDraftRef' in value){dead=true;throw Error('POWER_LOSS')}}};
 await expect(runDirectorOperation(store,new LocalEventLog(root),f.projectId,f.operationId,{decide,limits,root})).rejects.toThrow('POWER_LOSS');
 const before=(await f.store.readFresh<{musicChangeDraftRef:ObjectRef;musicChangePlanId:string}>(`projects/${f.projectId}/operations/${f.operationId}`)).value;
 await runDirectorOperation(new FileStore(root),new LocalEventLog(root),f.projectId,f.operationId,{decide,limits,root});
 const after=(await f.store.readFresh<typeof before&{status:string}>(`projects/${f.projectId}/operations/${f.operationId}`)).value;expect(after.status).toBe('succeeded');expect(after.musicChangeDraftRef).toEqual(before.musicChangeDraftRef);expect(after.musicChangePlanId).toBe(before.musicChangePlanId);expect(calls).toBe(1);
 expect((await f.store.readFresh<{calls:number}>(`projects/${f.projectId}/budget`)).value.calls).toBe(1);expect(await f.store.listKeys(`projects/${f.projectId}/change-drafts`,1)).toHaveLength(1);
});
it('T13 a consent change during interpretation leaves no candidate pointer or production',async()=>{
 const f=await fixture();let calls=0;
 await runDirectorOperation(f.store,new LocalEventLog(root),f.projectId,f.operationId,{limits,root,decide:async()=>{calls++;await updateJson(f.store,`projects/${f.projectId}/control`,(c:ProjectControl)=>({...c,consentEpoch:c.consentEpoch+1}));return{action:'change',effect:'pending_followup',executionIntent:'classify_change',reply:'记下调整，尚未改动视频。',evidenceMessageIds:[f.message.id],musicChange:{sourceMessageId:f.message.id,targetArtifactId:f.artifactId,revisionId:f.revisionId,musicGainDb:-3,gainMode:'relative',requestQuote:'音乐调小一点',reason:'明确降低整片配乐'}}}});
 const op=(await f.store.readFresh<{status:string;musicChangeDraftRef?:ObjectRef}>(`projects/${f.projectId}/operations/${f.operationId}`)).value;expect(op.status).toBe('interrupted');expect(op.musicChangeDraftRef).toBeUndefined();expect(calls).toBe(1);expect(await f.store.listKeys(`projects/${f.projectId}/change-drafts`,1)).toHaveLength(0);expect((await f.projects.access(owner,f.projectId)).activeProduction).toBeFalsy();
});
it('T13 legacy frozen Director inputs retain their original budget bytes instead of inferring new classification context',async()=>{
 const f=await fixture(),{reserveModelBudget}=await import('@/services/video/budget/model-budget'),{canonicalHash}=await import('@/services/video/domain/hash'),{directorContext}=await import('@/mastra/video/director');
 const control=await f.projects.access(owner,f.projectId),understanding=(await f.store.readFresh<import('@/contracts/video/domain').Understanding>(control.understandingRef.key)).value,messages=await f.projects.messages(control),context=messages.map(message=>({id:message.id,role:message.role,text:message.text,target:message.target}));
 const input={control,understanding,messages,context},projectContext={phase:control.phase,activeProductionId:control.activeProduction??null,briefVersion:control.briefVersion,consentEpoch:control.consentEpoch};
 await f.store.create(`projects/${f.projectId}/operations/${f.operationId}/director-input`,{schemaVersion:5,input,sha256:canonicalHash(input)});
 await reserveModelBudget(f.store,f.projectId,`${f.operationId}-director`,{inputTokens:Buffer.byteLength(JSON.stringify(directorContext(understanding,context,projectContext)))+4096,outputTokens:2000},limits);
 await f.store.create(`projects/${f.projectId}/operations/${f.operationId}/effects/director`,{status:'completed',attemptId:crypto.randomUUID(),output:{action:'acknowledge',effect:'no_change',executionIntent:'none',reply:'已记录。',evidenceMessageIds:[f.message.id]}});
 await runDirectorOperation(f.store,new LocalEventLog(root),f.projectId,f.operationId,{root,limits,decide:async()=>{throw Error('MUST_NOT_CALL')}});
 expect((await f.store.readFresh<{status:string}>(`projects/${f.projectId}/operations/${f.operationId}`)).value.status).toBe('succeeded');expect((await f.store.readFresh<{calls:number}>(`projects/${f.projectId}/budget`)).value.calls).toBe(1);
 expect((await f.store.readFresh<{input:{classificationContext?:unknown}}>(`projects/${f.projectId}/operations/${f.operationId}/director-input`)).value.input.classificationContext).toBeUndefined();
});
