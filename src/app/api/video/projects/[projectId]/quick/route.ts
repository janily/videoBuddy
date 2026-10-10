import {z} from 'zod';
import {body,writeAccess,projectService,json,errorResponse} from '@/services/video/http/route-utils';
import {MusicChoiceSchema,quickFlow,updateQuickSettings} from '@/services/video/quick/settings';
import {loadMusicLibrary} from '@/services/video/music/library';
import {readAnyResultManifest} from '@/services/video/results/publish';
const RequestSchema=z.strictObject({schemaVersion:z.literal(5),music:MusicChoiceSchema.optional(),redoShotId:z.string().min(1).max(120).optional()}).refine(r=>Boolean(r.music)!==Boolean(r.redoShotId));
/** Change the music or ask for one shot to be drawn again. The next generation applies it;
 * everything that did not change is reused, so only the music mix or that one shot is redone. */
export async function POST(request:Request,{params}:{params:Promise<{projectId:string}>}){
 try{
  if(!quickFlow())throw Error('CAPABILITY_UNAVAILABLE');
  const owner=writeAccess(request),input=await body(request,RequestSchema),{projectId}=await params,projects=projectService(),control=await projects.access(owner,projectId);
  if(control.activeProduction)throw Error('BUSY');
  if(input.music?.mode==='track'){const library=await loadMusicLibrary();if(!library?.tracks.some(track=>track.id===(input.music as {trackId:string}).trackId))throw Error('VALIDATION_FAILED')}
  if(input.redoShotId){
   if(!control.currentResultId)throw Error('RESULT_STALE');
   const result=await readAnyResultManifest(projects,projectId,control.currentResultId);
   if(result.kind!=='quick'||result.briefVersion!==control.briefVersion||!result.shots.some(shot=>shot.id===input.redoShotId))throw Error('RESULT_STALE');
  }
  await updateQuickSettings(projects.store,projectId,{music:input.music,redoShotId:input.redoShotId,briefVersion:control.briefVersion});
  return json(await projects.view(owner,projectId));
 }catch(error){return errorResponse(error)}
}
