import {z}from 'zod';
import {assertWriteOrigin,requestOwner}from '@/services/video/access/session';
import {productionStore}from '@/services/video/storage/file-store';
import {StoreMissing} from '@/services/video/storage/atomic-store';
import {ProjectStore}from '@/services/video/storage/project-store';
import {userErrorCode,userErrorMessage} from './user-messages';
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
export function errorResponse(error:unknown){const raw=error instanceof StoreMissing?'ACCESS_NOT_FOUND':error instanceof Error?error.message:'UNKNOWN_ERROR';const code=userErrorCode(raw);const status=code==='ACCESS_NOT_FOUND'?404:code==='PROJECT_EXPIRED'?410:code==='ORIGIN_FORBIDDEN'?403:['VALIDATION_FAILED','ASSET_INVALID'].includes(code)?400:['MEDIA_STOP_UNKNOWN','BRIEF_CONFLICT','PREVIEW_STALE','PREVIEW_INPUT_INCOMPLETE','RECOVERY_REQUIRED','INPUT_PENDING','AUTHORIZATION_REQUIRED','BUSY','IDEMPOTENCY_CONFLICT','ASSET_LIMIT','ASSET_HASH_CONFLICT','RESULT_STALE','QUALITY_BLOCKED','CAPABILITY_UNAVAILABLE','ARCHIVE_PRIVATE_DATA','ARCHIVE_ASSET_REDISTRIBUTION_REQUIRED','MVP_PROFILE_UNSUPPORTED','SOUND_DISABLED'].includes(code)?409:503;return json({error:{code,message:userErrorMessage(code),retryable:status===503,requestId:crypto.randomUUID()},...((error as {receipt?:unknown})?.receipt?{receipt:(error as {receipt:unknown}).receipt}:{})},status)}
