import {z} from 'zod';
import {randomUUID} from 'node:crypto';
import {body,writeAccess,projectService,json,errorResponse} from '@/services/video/http/route-utils';
import {MusicChoiceSchema,quickFlow,updateQuickSettings,readQuickSettings,type MusicChoice} from '@/services/video/quick/settings';
import {loadMusicLibrary} from '@/services/video/music/library';
import {readAnyResultManifest} from '@/services/video/results/publish';
import {createOrRead,updateJson} from '@/services/video/storage/atomic-store';
import {canonicalHash} from '@/services/video/domain/hash';
import type {ProjectStore} from '@/services/video/storage/project-store';
import type {ProjectControl} from '@/contracts/video/project';
import {assertLiveProject,userActivity} from '@/services/video/commands/user-activity';
const RequestSchema=z.strictObject({schemaVersion:z.literal(5),music:MusicChoiceSchema.optional(),redoShotId:z.string().min(1).max(120).optional(),clientCommandId:z.uuid().optional(),origin:z.literal('canvas').optional()}).refine(r=>Boolean(r.music)!==Boolean(r.redoShotId));
async function canvasChange(projects:ProjectStore,owner:string,projectId:string,input:{music?:MusicChoice;redoShotId?:string;clientCommandId:string;origin?:'canvas'},title?:string){
 const p=`projects/${projectId}`,key=`${p}/commands/${input.clientCommandId}`,hash=canonicalHash({kind:input.music?'canvas_music':'canvas_redraw',input});
 const text=!input.music?'':input.music.mode==='off'?'关闭配乐':input.music.mode==='auto'?'配乐改成自动选择':`配乐改成「${title||input.music.trackId}」`;
 const intent=await createOrRead(projects.store,key,{hash,userId:randomUUID(),assistantId:randomUUID(),text,admittedAt:Date.now()});
 if(intent.hash!==hash)throw Error('IDEMPOTENCY_CONFLICT');
 // The setting and both archived messages become visible in one control CAS. The
 // user message is the replay marker; no transient operation can strand a tab.
 await updateJson(projects.store,`${p}/control`,async(c:ProjectControl)=>{
  assertLiveProject(c);if(c.ownerKeyHash!==owner)throw Error('ACCESS_NOT_FOUND');
  if((await projects.index.all(c.messagesIndexRef)).some(message=>message.id===intent.userId))return c;
  if(c.activeProduction||c.activeConversation)throw Error('BUSY');
  if(c.controlVersion>=Number.MAX_SAFE_INTEGER||c.nextOrdinal>Number.MAX_SAFE_INTEGER-2)throw Error('CONTROL_SIZE_LIMIT');
  let text=intent.text,quickTakes=c.quickTakes;
  if(input.redoShotId){
   if(!c.currentResultId)throw Error('RESULT_STALE');
   const result=await readAnyResultManifest(projects,projectId,c.currentResultId);
   if(result.kind!=='quick'||result.briefVersion!==c.briefVersion)throw Error('RESULT_STALE');
   const shotIndex=result.shots.findIndex(shot=>shot.id===input.redoShotId);if(shotIndex<0)throw Error('RESULT_STALE');
   const settings=await readQuickSettings(projects.store,projectId),takes=settings.takesBriefVersion===c.briefVersion?{...settings.takes}:{};
   takes[input.redoShotId]=Math.min(50,(takes[input.redoShotId]||0)+1);quickTakes={briefVersion:c.briefVersion,takes};text=`重画第 ${shotIndex+1} 镜`;
  }
  const reply=!input.music?`已记下，下一次生成会${text}。`:input.music.mode==='off'?'配乐已关闭，下次生成时生效。':input.music.mode==='auto'?'已设为自动配乐，下次生成时生效。':'配乐已选好，下次生成时生效。';
  const user={id:intent.userId,ordinal:c.nextOrdinal,role:'user' as const,text,...(input.origin?{origin:input.origin}:{}),status:'completed' as const,contentVersion:1,clientMessageId:input.clientCommandId};
  const assistant={id:intent.assistantId,ordinal:c.nextOrdinal+1,role:'assistant' as const,text:reply,status:'completed' as const,contentVersion:1};
  let messagesIndexRef=c.messagesIndexRef;
  for(const message of [user,assistant]){const ref=await projects.index.immutable(`${p}/messages/${message.id}/1`,message);messagesIndexRef=await projects.index.append(`${p}/indexes/messages`,messagesIndexRef,{id:message.id,ordinal:message.ordinal,ref})}
  return{...c,...userActivity(undefined,Math.max(Date.parse(c.lastUserActivityAt),intent.admittedAt)),...(input.music?{quickMusic:input.music}:{}),...(quickTakes?{quickTakes}:{}),messagesIndexRef,controlVersion:c.controlVersion+1,nextOrdinal:c.nextOrdinal+2};
 });
}
/** Change the music or ask for one shot to be drawn again. The next generation applies it;
 * everything that did not change is reused, so only the music mix or that one shot is redone. */
export async function POST(request:Request,{params}:{params:Promise<{projectId:string}>}){
 try{
  if(!quickFlow())throw Error('CAPABILITY_UNAVAILABLE');
  const owner=writeAccess(request),input=await body(request,RequestSchema),{projectId}=await params,projects=projectService(),control=await projects.access(owner,projectId);
  let trackTitle:string|undefined;
  if(input.music?.mode==='track'){const library=await loadMusicLibrary(),track=library?.tracks.find(track=>track.id===(input.music as {trackId:string}).trackId);if(!track)throw Error('VALIDATION_FAILED');trackTitle=track.title}
  if(input.origin==='canvas'||input.clientCommandId){
   await canvasChange(projects,owner,projectId,{...(input.music?{music:input.music}:{}),...(input.redoShotId?{redoShotId:input.redoShotId}:{}),clientCommandId:input.clientCommandId||randomUUID(),...(input.origin?{origin:input.origin}:{})},trackTitle);
   return json(await projects.view(owner,projectId));
  }
  if(control.activeProduction||control.activeConversation)throw Error('BUSY');
  if(input.redoShotId){
   if(!control.currentResultId)throw Error('RESULT_STALE');
   const result=await readAnyResultManifest(projects,projectId,control.currentResultId);
   if(result.kind!=='quick'||result.briefVersion!==control.briefVersion||!result.shots.some(shot=>shot.id===input.redoShotId))throw Error('RESULT_STALE');
  }
  await updateQuickSettings(projects.store,projectId,{music:input.music,redoShotId:input.redoShotId,briefVersion:control.briefVersion});
  return json(await projects.view(owner,projectId));
 }catch(error){return errorResponse(error)}
}
