import {randomUUID}from 'node:crypto';
import {AtomicStore,createOrRead,updateJson,StoreMissing}from './atomic-store';
import {IndexStore}from './index-store';
import {initialUnderstanding,Understanding}from '@/contracts/video/domain';
import {mvpProfile,soundEnabled}from '@/services/video/quality/delivery';
import {ProjectControl,ProjectView,ArchivedMessage,PublicOperation}from '@/contracts/video/project';
import {CreateProjectRequest}from '@/contracts/video/commands';
import {canonicalHash}from '@/services/video/domain/hash';
import {readPreviewBundle}from '@/services/video/preview/commit';
import {readResultManifest}from '@/services/video/results/publish';
import {previewAction,approvalAction}from '@/services/video/preview/action';
import {assertLiveProject}from '@/services/video/commands/user-activity';
import {pendingFeedbackMessageIds}from '@/services/video/revisions/pending-feedback';
import {unknownMediaStopMessage} from '@/services/video/media/stop-state';
/** Projects are created before the conversation names them, so the stored title
 * stays the placeholder. Prefer the understood subject for display. */
const placeholderTitle='新视频';
export function displayTitle(title:string,subject:string){const s=subject.trim().replace(/\s+/g,' ');return title&&title!==placeholderTitle?title:s?(s.length>24?s.slice(0,24)+'…':s):placeholderTitle}
/** New projects start inside what the configured delivery can make, so the
 * conversation does not have to undo defaults (45s, narration, music) first. */
function deliveryDefaults(env:Record<string,string|undefined>=process.env):Partial<Understanding['preferences']>{
 return{...(env.VIDEO_DELIVERY_PROFILE==='mvp'?{durationSec:mvpProfile.maxDurationSec}:{}),...(soundEnabled(env)?{}:{voiceMode:'none' as const,musicMode:'none' as const,captions:'none' as const})};
}
export class ProjectStore{
 readonly index:IndexStore;constructor(readonly store:AtomicStore){this.index=new IndexStore(store)}
 async create(owner:string,input:CreateProjectRequest){
  const intent=await createOrRead(this.store,`create-intents/${owner}/${input.clientCreateId}`,{projectId:randomUUID(),hash:canonicalHash(input),title:input.title||'新视频'});
  if(intent.hash!==canonicalHash(input))throw Error('IDEMPOTENCY_CONFLICT');
  const p=`projects/${intent.projectId}`;const now=new Date().toISOString();const understanding=initialUnderstanding();understanding.preferences={...understanding.preferences,...deliveryDefaults()};if(input.preferences)understanding.preferences={...understanding.preferences,...input.preferences};
  const control:ProjectControl={schemaVersion:5,projectId:intent.projectId,ownerKeyHash:owner,controlVersion:0,briefVersion:0,createdAt:now,lastUserActivityAt:now,expiresAt:new Date(Date.now()+30*86400000).toISOString(),reviewPolicy:'preview_first',phase:'collecting',understandingRef:await this.index.immutable(`${p}/understanding/0`,understanding),messagesIndexRef:await this.index.empty(`${p}/indexes/messages`),revisionIndexRef:await this.index.empty(`${p}/indexes/revisions`),assets:[],inputPending:false,previewState:'none',receipts:[],consentEpoch:0,nextOrdinal:1,ordinalReservations:{}};
  await createOrRead(this.store,`${p}/control`,control);await createOrRead(this.store,`${p}/metadata`,{title:intent.title});return{projectId:intent.projectId,controlVersion:0};
 }
 async access(owner:string,id:string){
  let control:ProjectControl;try{control=(await this.store.readFresh<ProjectControl>(`projects/${id}/control`)).value}catch(e){if(e instanceof StoreMissing)throw Error('ACCESS_NOT_FOUND');throw e}
  if(control.ownerKeyHash!==owner)throw Error('ACCESS_NOT_FOUND');if(control.deletedAt){if(control.expiration)throw Error('PROJECT_EXPIRED');throw Error('ACCESS_NOT_FOUND')}if(!Number.isFinite(Date.parse(control.expiresAt)))throw Error('RETENTION_RECORD_INVALID');if(Date.parse(control.expiresAt)<=Date.now())throw Error('PROJECT_EXPIRED');return control;
 }
 async archiveMessage(projectId:string,message:ArchivedMessage){
  const p=`projects/${projectId}`;const ref=await this.index.immutable(`${p}/messages/${message.id}/${message.contentVersion}`,message);
  return updateJson(this.store,`${p}/control`,async(c:ProjectControl)=>{
   if(c.deletedAt)throw Error('ACCESS_NOT_FOUND');
   const existing=(await this.index.all(c.messagesIndexRef)).find(e=>e.id===message.id);
   if(existing){const archived=(await this.store.readFresh<ArchivedMessage>(existing.ref.key)).value;if(archived.contentVersion>message.contentVersion||(archived.contentVersion===message.contentVersion&&archived.status==='completed'))return c;}
   if(message.role==='user')assertLiveProject(c);
   return {...c,controlVersion:c.controlVersion+1,messagesIndexRef:await this.index.append(`${p}/indexes/messages`,c.messagesIndexRef,{id:message.id,ordinal:message.ordinal,ref})};
  });
 }
 async messages(control:ProjectControl){const entries=await this.index.all(control.messagesIndexRef);return Promise.all(entries.map(async e=>(await this.store.readFresh<ArchivedMessage>(e.ref.key)).value))}
 async publicMessages(control:ProjectControl){return(await this.messages(control)).map(message=>{const publicMessage={...message};delete publicMessage.speechReviewAction;delete publicMessage.narrationPolicyAction;return publicMessage})}
 async operation(projectId:string,id?:string|null):Promise<PublicOperation|null>{if(!id)return null;const o=(await this.store.readFresh<PublicOperation>(`projects/${projectId}/operations/${id}`)).value;return{id:o.id,kind:o.kind,status:o.status,streamEpoch:o.streamEpoch,stage:o.stage}}
 async view(owner:string,id:string):Promise<ProjectView>{
  const c=await this.access(owner,id);const u=(await this.store.readFresh<Understanding>(c.understandingRef.key)).value;const meta=(await this.store.readFresh<{title:string}>(`projects/${id}/metadata`)).value;
  const preview=c.currentPreviewId?await readPreviewBundle(this,id,c.currentPreviewId):null;
  const currentPreview=preview?{previewId:preview.previewId,revisionId:preview.revisionId,briefVersion:preview.briefVersion,previewArtifactId:preview.previewArtifactId,bundleHash:preview.bundleHash,scriptHash:preview.scriptHash,factsHash:preview.factsHash,script:preview.script,criticalFacts:preview.criticalFacts,summary:preview.summary,expiresAt:preview.expiresAt,state:c.previewState}:null;
  const publicResult=async(resultId?:string)=>{if(!resultId)return null;const result=await readResultManifest(this,id,resultId);return{resultId:result.resultId,artifactId:result.artifactId,revisionId:result.revisionId,bundleHash:result.bundleHash,createdAt:result.createdAt}};
  let productionFailure:ProjectView['productionFailure'];
  const renderLast=c.latestRenderOutcome,previewLast=c.latestPreviewOutcome;
  const order=(marker:typeof renderLast)=>marker?.controlVersion??c.receipts.filter(r=>r.operationId===marker?.operationId).at(-1)?.controlVersion??-1;
  const matches=(marker:typeof renderLast)=>marker?.briefVersion===c.briefVersion&&marker.consentEpoch===c.consentEpoch;
  const last=matches(renderLast)&&(!matches(previewLast)||order(renderLast)>=order(previewLast))?renderLast:previewLast,isRender=last===renderLast;
  if(last&&!c.activeProduction&&last.briefVersion===c.briefVersion&&last.consentEpoch===c.consentEpoch){
   let outcome=(isRender?c.renderOutcomes:c.previewOutcomes)?.[last.operationId];
   if(!outcome)try{outcome=(await this.store.readFresh<NonNullable<ProjectControl['previewOutcomes']>[string]>(`projects/${id}/operations/${last.operationId}/${isRender?'render':'preview'}-outcome`)).value}catch(error){if(!(error instanceof StoreMissing))throw error}
   if(outcome?.status==='failed'||outcome?.status==='interrupted'){
    const code=outcome.errorCode||'PROVIDER_UNAVAILABLE';
    const message=code==='COMPOSITION_PRODUCER_UNKNOWN'?'合成来源未通过核验，资料和已有视频已保留。请重新生成效果。':code==='MVP_PROFILE_UNSUPPORTED'?'当前版本先支持横屏、20–30 秒的视频，请在聊天里调整后再看效果。':code==='SOUND_DISABLED'?'当前版本先只做画面（无旁白、无配乐）。跟助手说一句“不要声音”就能继续。':code==='MODEL_OUTPUT_INVALID'?'创作结果格式未通过核验，资料和已有内容已保留。':['AUDIO_PLAN_INVALID','AUDIO_EVENT_INVALID','AUDIO_TIMELINE_INVALID'].includes(code)?'音乐或音效的编排未通过核验，资料和已有声音已保留。':code==='VISUAL_SOURCE_INVALID'?'画面源码未通过核验，资料和已生成画面已保留。':code==='PICTURE_RENDER_FAILED'?'画面渲染未通过，资料和已有内容已保留。':code==='ASR_TIMINGS_UNAVAILABLE'?'声音时序核验未通过，资料和已有片段已保留。':code==='QUALITY_BLOCKED'?'完整视频的视听质量或许可证据尚未通过，效果片段和已有结果已保留。':code==='PREVIEW_QUALITY_BLOCKED'?'效果检查未通过，已有片段和资料已保留，请继续调整。':['ASR_MISMATCH','POSTMIX_ASR_MISMATCH'].includes(code)?'声音核验未通过，资料和已有片段已保留。':['EFFECT_UNKNOWN','MODEL_USAGE_UNCERTAIN','MODEL_BUDGET_OVERRUN','MODEL_ACCOUNTING_MIGRATION_REQUIRED'].includes(code)?'上次模型调用的用量需要核实，资料已保留。':isRender?'本次完整视频制作未完成，效果片段和已有结果已保留。':'本次效果制作未完成，资料和已有内容已保留。';
    productionFailure={operationId:last.operationId,errorCode:code,message};
   }
  }
  const unresolved=Object.keys(c.unresolvedMediaStops||{})[0];
  if(unresolved&&!c.activeProduction)productionFailure={operationId:unresolved,errorCode:'MEDIA_STOP_UNKNOWN',message:unknownMediaStopMessage};
  return{productionFailure,projectId:id,title:displayTitle(meta.title,u.subject),controlVersion:c.controlVersion,briefVersion:c.briefVersion,phase:c.phase,understanding:{summary:u.summary,subject:u.subject},preferences:u.preferences,assets:c.assets.map(a=>({id:a.id,filename:a.filename,status:a.status,intendedUse:a.intendedUse,errorCode:a.errorCode})),messages:(await this.publicMessages(c)).slice(-50),currentPreview,currentResult:await publicResult(c.currentResultId),previousResult:await publicResult(c.previousResultId),activeConversation:await this.operation(id,c.activeConversation),activeProduction:await this.operation(id,c.activeProduction),pendingInputs:await pendingFeedbackMessageIds(this,c),actions:[previewAction(c,u),...(preview?[approvalAction(c,preview)]:[])],expiresAt:c.expiresAt};
 }
 async lookup(owner:string,ids:string[]){
  if(ids.length>20)throw Error('VALIDATION_FAILED');
  const projects=await Promise.all([...new Set(ids)].map(async id=>{try{const c=await this.access(owner,id),meta=(await this.store.readFresh<{title:string}>(`projects/${id}/metadata`)).value,u=(await this.store.readFresh<Understanding>(c.understandingRef.key)).value;return{projectId:id,title:displayTitle(meta.title,u.subject),phase:c.phase,lastUserActivityAt:c.lastUserActivityAt,expiresAt:c.expiresAt}}catch(error){if(error instanceof Error&&['ACCESS_NOT_FOUND','PROJECT_EXPIRED'].includes(error.message))return null;throw error}}));
  return projects.filter(p=>p!==null).sort((a,b)=>b.lastUserActivityAt.localeCompare(a.lastUserActivityAt));
 }
 async tombstone(owner:string,id:string){await updateJson(this.store,`projects/${id}/control`,(c:ProjectControl)=>{if(c.ownerKeyHash!==owner)throw Error('ACCESS_NOT_FOUND');if(c.deletedAt)return c;if(Date.parse(c.expiresAt)<=Date.now())throw Error('PROJECT_EXPIRED');return{...c,controlVersion:c.controlVersion+1,deletedAt:new Date().toISOString(),consentEpoch:c.consentEpoch+1}});return{status:'cancelling'}}
}
