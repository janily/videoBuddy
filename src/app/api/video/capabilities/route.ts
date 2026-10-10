import {requestOwner} from '@/services/video/access/session';
import {json,errorResponse} from '@/services/video/http/route-utils';
export async function GET(request:Request){try{requestOwner(request);return json({unsafeNoSandbox:process.env.NODE_ENV!=='production'&&process.env.VIDEO_UNSAFE_NO_SANDBOX==='1'})}catch(error){return errorResponse(error)}}
