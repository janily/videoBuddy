import {randomUUID}from 'node:crypto';
import {AtomicStore,createOrRead,updateJson,StoreMissing}from './atomic-store';
import {IndexStore}from './index-store';
import {initialUnderstanding,Understanding}from '@/contracts/video/domain';
import {ProjectControl,ProjectView,ArchivedMessage,PublicOperation}from '@/contracts/video/project';
import {CreateProjectRequest}from '@/contracts/video/commands';
import {canonicalHash}from '@/services/video/domain/hash';
import {readPreviewBundle}from '@/services/video/preview/commit';
import {readResultManifest}from '@/services/video/results/publish';
export class ProjectStore{
 readonly index:IndexStore;constructor(readonly store:AtomicStore){this.index=new IndexStore(store)}
 async create(owner:string,input:CreateProjectRequest){
  const intent=await createOrRead(this.store,`create-intents/${owner}/${input.clientCreateId}`,{projectId:randomUUID(),hash:canonicalHash(input),title:input.title||'新视频'});
  if(intent.hash!==canonicalHash(input))throw Error('IDEMPOTENCY_CONFLICT');
  const p=`projects/${intent.projectId}`;const now=new Date().toISOString();const understanding=initialUnderstanding();if(input.preferences)understanding.preferences={...understanding.preferences,...input.preferences};
  const control:ProjectControl={schemaVersion:5,projectId:intent.projectId,ownerKeyHash:owner,controlVersion:0,briefVersion:0,createdAt:now,lastUserActivityAt:now,expiresAt:new Date(Date.now()+30*86400000).toISOString(),reviewPolicy:'preview_first',phase:'collecting',understandingRef:await this.index.immutable(`${p}/understanding/0`,understanding),messagesIndexRef:await this.index.empty(`${p}/indexes/messages`),revisionIndexRef:await this.index.empty(`${p}/indexes/revisions`),assets:[],inputPending:false,previewState:'none',receipts:[],consentEpoch:0,nextOrdinal:1,ordinalReservations:{}};
  await createOrRead(this.store,`${p}/control`,control);await createOrRead(this.store,`${p}/metadata`,{title:intent.title});return{projectId:intent.projectId,controlVersion:0};
 }
 async access(owner:string,id:string){
  let control:ProjectControl;try{control=(await this.store.readFresh<ProjectControl>(`projects/${id}/control`)).value}catch(e){if(e instanceof StoreMissing)throw Error('ACCESS_NOT_FOUND');throw e}
  if(control.ownerKeyHash!==owner||control.deletedAt)throw Error('ACCESS_NOT_FOUND');if(Date.parse(control.expiresAt)<=Date.now())throw Error('PROJECT_EXPIRED');return control;
 }
 async archiveMessage(projectId:string,message:ArchivedMessage){
  const p=`projects/${projectId}`;const ref=await this.index.immutable(`${p}/messages/${message.id}/${message.contentVersion}`,message);
  return updateJson(this.store,`${p}/control`,async(c:ProjectControl)=>{
   if(c.deletedAt)throw Error('ACCESS_NOT_FOUND');
   const existing=(await this.index.all(c.messagesIndexRef)).find(e=>e.id===message.id);
   if(existing){const archived=(await this.store.readFresh<ArchivedMessage>(existing.ref.key)).value;if(archived.contentVersion>message.contentVersion||(archived.contentVersion===message.contentVersion&&archived.status==='completed'))return c;}
   const now=new Date().toISOString();
   return {...c,controlVersion:c.controlVersion+1,...(message.role==='user'?{lastUserActivityAt:now,expiresAt:new Date(Date.parse(now)+30*86400000).toISOString()}:{}),messagesIndexRef:await this.index.append(`${p}/indexes/messages`,c.messagesIndexRef,{id:message.id,ordinal:message.ordinal,ref})};
  });
 }
 async messages(control:ProjectControl){const entries=await this.index.all(control.messagesIndexRef);return Promise.all(entries.map(async e=>(await this.store.readFresh<ArchivedMessage>(e.ref.key)).value))}
 async operation(projectId:string,id?:string|null):Promise<PublicOperation|null>{if(!id)return null;const o=(await this.store.readFresh<PublicOperation>(`projects/${projectId}/operations/${id}`)).value;return{id:o.id,kind:o.kind,status:o.status,streamEpoch:o.streamEpoch,stage:o.stage}}
 async view(owner:string,id:string):Promise<ProjectView>{
  const c=await this.access(owner,id);const u=(await this.store.readFresh<Understanding>(c.understandingRef.key)).value;const meta=(await this.store.readFresh<{title:string}>(`projects/${id}/metadata`)).value;
  const preview=c.currentPreviewId?await readPreviewBundle(this,id,c.currentPreviewId):null;
  const currentPreview=preview?{previewId:preview.previewId,revisionId:preview.revisionId,briefVersion:preview.briefVersion,previewArtifactId:preview.previewArtifactId,bundleHash:preview.bundleHash,scriptHash:preview.scriptHash,factsHash:preview.factsHash,script:preview.script,criticalFacts:preview.criticalFacts,summary:preview.summary,expiresAt:preview.expiresAt,state:c.previewState}:null;
  const publicResult=async(resultId?:string)=>{if(!resultId)return null;const result=await readResultManifest(this,id,resultId);return{resultId:result.resultId,artifactId:result.artifactId,revisionId:result.revisionId,bundleHash:result.bundleHash,createdAt:result.createdAt}};
  return{projectId:id,title:meta.title,controlVersion:c.controlVersion,briefVersion:c.briefVersion,phase:c.phase,understanding:{summary:u.summary,subject:u.subject},preferences:u.preferences,assets:c.assets.map(a=>({id:a.id,filename:a.filename,status:a.status,intendedUse:a.intendedUse,errorCode:a.errorCode})),messages:(await this.messages(c)).slice(-50),currentPreview,currentResult:await publicResult(c.currentResultId),previousResult:await publicResult(c.previousResultId),activeConversation:await this.operation(id,c.activeConversation),activeProduction:await this.operation(id,c.activeProduction),pendingInputs:[],actions:[{kind:'prepare_preview',enabled:false,disabledReason:'真实创作预览尚未就绪。'}],expiresAt:c.expiresAt};
 }
 async lookup(owner:string,ids:string[]){
  if(ids.length>20)throw Error('VALIDATION_FAILED');
  const projects=await Promise.all([...new Set(ids)].map(async id=>{try{const c=await this.access(owner,id),meta=(await this.store.readFresh<{title:string}>(`projects/${id}/metadata`)).value;return{projectId:id,title:meta.title,phase:c.phase,lastUserActivityAt:c.lastUserActivityAt,expiresAt:c.expiresAt}}catch(error){if(error instanceof Error&&['ACCESS_NOT_FOUND','PROJECT_EXPIRED'].includes(error.message))return null;throw error}}));
  return projects.filter(p=>p!==null).sort((a,b)=>b.lastUserActivityAt.localeCompare(a.lastUserActivityAt));
 }
 async tombstone(owner:string,id:string){await this.access(owner,id);await updateJson(this.store,`projects/${id}/control`,(c:ProjectControl)=>({...c,controlVersion:c.controlVersion+1,deletedAt:new Date().toISOString(),consentEpoch:c.consentEpoch+1}));return{status:'cancelling'}}
}
