import {issueSession,verifySession,sessionKeys,assertWriteOrigin}from '@/services/video/access/session';
import {json,errorResponse}from '@/services/video/http/route-utils';
export async function POST(request:Request){try{
 const keys=sessionKeys();if(!process.env.VIDEO_APP_ORIGIN)throw Error('CONFIGURATION_REQUIRED');assertWriteOrigin(request,process.env.VIDEO_APP_ORIGIN,process.env.NODE_ENV==='development'?'development':'production');
 const old=request.headers.get('cookie')?.split(';').map(s=>s.trim()).find(s=>s.startsWith('vb-session='))?.slice(11);let sid:string|undefined;
 if(old){try{sid=verifySession(old,keys).sid}catch{}}
 const issued=issueSession(keys,Date.now(),sid);const response=json({expiresAt:new Date(issued.expiresAt).toISOString()});response.headers.set('Set-Cookie',`vb-session=${issued.token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000${process.env.NODE_ENV==='development'?'':'; Secure'}`);return response;
}catch(e){return errorResponse(e)}}
