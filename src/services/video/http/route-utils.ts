import {z}from 'zod';
import {assertWriteOrigin,requestOwner}from '@/services/video/access/session';
import {productionStore}from '@/services/video/storage/file-store';
import {StoreMissing} from '@/services/video/storage/atomic-store';
import {ProjectStore}from '@/services/video/storage/project-store';
import {unknownMediaStopMessage} from '@/services/video/media/stop-state';
export const privateHeaders={'Cache-Control':'private, no-store'};
export function json(value:unknown,status=200){return Response.json(value,{status,headers:privateHeaders})}
export async function body<T>(request:Request,schema:z.ZodType<T>):Promise<T>{
 const reader=request.body?.getReader();if(!reader)throw Error('VALIDATION_FAILED');let total=0;const chunks:Uint8Array[]=[];
 for(;;){const {done,value}=await reader.read();if(done)break;total+=value.byteLength;if(total>256*1024){await reader.cancel();throw Error('VALIDATION_FAILED')}chunks.push(value)}
 const bytes=new Uint8Array(total);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength}
 try{return schema.parse(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)))}catch{throw Error('VALIDATION_FAILED')}
}
export function writeAccess(request:Request){if(!process.env.VIDEO_APP_ORIGIN)throw Error('CONFIGURATION_REQUIRED');assertWriteOrigin(request,process.env.VIDEO_APP_ORIGIN,process.env.NODE_ENV==='development'?'development':'production');return requestOwner(request)}
export function projectService(){return new ProjectStore(productionStore())}
const messages:Record<string,string>={BRIEF_CONFLICT:'内容版本已经更新，请刷新后再看效果。',PREVIEW_STALE:'效果基线已经变化，请刷新后重试。',PREVIEW_INPUT_INCOMPLETE:'请先确认主题、风格和有冲突的资料。',RECOVERY_REQUIRED:'已有任务正在恢复，请稍后重试。',INPUT_PENDING:'资料尚未处理完成，请稍后再看效果。',AUTHORIZATION_REQUIRED:'请从已保存的用户消息发起制作。',BUDGET_EXCEEDED:'本次创作预算已用完，已有内容已保留。',CONFIGURATION_REQUIRED:'服务尚未配置，草稿已保留。',GENERATION_DISABLED:'制作服务尚未开放，草稿已保留。',ACCESS_NOT_FOUND:'无法访问这个项目。',PROJECT_EXPIRED:'项目已超过保存期限。',VALIDATION_FAILED:'提交内容不符合要求，请检查后重试。',ASSET_INVALID:'文件内容或大小不符合要求。',ASSET_LIMIT:'项目素材数量或容量已达上限。',ASSET_HASH_CONFLICT:'此素材已有不同内容，请重新预约。',RESULT_STALE:'当前结果已变化，请刷新后再试。',ARTIFACT_INVALID:'保存的视频无法验证，请稍后再试。',ORIGIN_FORBIDDEN:'请求来源无法验证。',BUSY:'已有一轮回复进行中，这条想法可以稍后发送。',START_FAILED:'任务已保存但尚未启动，请使用原请求重试。',IDEMPOTENCY_CONFLICT:'这次请求内容已变化，请重新提交。',EFFECT_UNKNOWN:'上次调用结果未知，需要先核实用量。',PROVIDER_UNAVAILABLE:'创作助手暂时无法连接，资料和消息已保留。'};
Object.assign(messages,{MEDIA_STOP_UNKNOWN:unknownMediaStopMessage,QUALITY_BLOCKED:'成片质量检查尚未通过，暂时无法导出。',CAPABILITY_UNAVAILABLE:'此导出格式尚未开放。',ARCHIVE_PRIVATE_DATA:'工程资料包含访问凭据，暂时无法导出。',ARCHIVE_ASSET_REDISTRIBUTION_REQUIRED:'素材分发权限尚未确认，暂时无法导出工程包。'});
export function errorResponse(error:unknown){const raw=error instanceof StoreMissing?'ACCESS_NOT_FOUND':error instanceof Error?error.message:'UNKNOWN_ERROR';const code=Object.keys(messages).find(k=>raw.startsWith(k))||'SERVICE_UNAVAILABLE';const status=code==='ACCESS_NOT_FOUND'?404:code==='PROJECT_EXPIRED'?410:code==='ORIGIN_FORBIDDEN'?403:['VALIDATION_FAILED','ASSET_INVALID'].includes(code)?400:['MEDIA_STOP_UNKNOWN','BRIEF_CONFLICT','PREVIEW_STALE','PREVIEW_INPUT_INCOMPLETE','RECOVERY_REQUIRED','INPUT_PENDING','AUTHORIZATION_REQUIRED','BUSY','IDEMPOTENCY_CONFLICT','ASSET_LIMIT','ASSET_HASH_CONFLICT','RESULT_STALE','QUALITY_BLOCKED','CAPABILITY_UNAVAILABLE','ARCHIVE_PRIVATE_DATA','ARCHIVE_ASSET_REDISTRIBUTION_REQUIRED'].includes(code)?409:503;return json({error:{code,message:messages[code]||'服务暂时不可用，请稍后重试。',retryable:status===503,requestId:crypto.randomUUID()},...((error as {receipt?:unknown})?.receipt?{receipt:(error as {receipt:unknown}).receipt}:{})},status)}
