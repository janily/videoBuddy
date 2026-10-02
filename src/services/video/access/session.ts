import {createHmac,createHash,randomBytes,timingSafeEqual} from 'node:crypto';
import {z} from 'zod';
export interface SessionKeys{current:string;keyId:string;environment:string;previous?:string;previousKeyId?:string}
const payloadSchema=z.strictObject({sid:z.string().regex(/^[a-f0-9]{64}$/),keyId:z.string(),environment:z.string(),expiresAt:z.number().int()});
function mac(value:string,key:string){return createHmac('sha256',key).update(value).digest('base64url')}
export function issueSession(keys:SessionKeys,now=Date.now(),sid=randomBytes(32).toString('hex')){
 if(keys.current.length<32||!keys.environment)throw Error('CONFIGURATION_REQUIRED: session key');
 const expiresAt=now+30*86400000;const body=Buffer.from(JSON.stringify({sid,keyId:keys.keyId,environment:keys.environment,expiresAt})).toString('base64url');
 return{token:body+'.'+mac(body,keys.current),expiresAt};
}
export function verifySession(token:string,keys:SessionKeys,now=Date.now()){
 try{const parts=token.split('.');if(parts.length!==2)throw Error();const [body,signature]=parts;
  const payload=payloadSchema.parse(JSON.parse(Buffer.from(body,'base64url').toString()));
  const key=payload.keyId===keys.keyId?keys.current:payload.keyId===keys.previousKeyId?keys.previous:undefined;if(!key||payload.environment!==keys.environment||payload.expiresAt<=now)throw Error();
  const expected=Buffer.from(mac(body,key)),actual=Buffer.from(signature);if(actual.length!==expected.length||!timingSafeEqual(actual,expected))throw Error();return payload;
 }catch{throw Error('ACCESS_NOT_FOUND')}
}
// Scope derives from the 256-bit secret sid and environment, independent of rotating signing keys.
export function ownerHash(sid:string,keys:SessionKeys){return createHash('sha256').update(`video-owner:${keys.environment}:${sid}`).digest('hex')}
export function assertOwner(actual:string,expected:string){if(actual!==expected)throw Error('ACCESS_NOT_FOUND')}
export function assertWriteOrigin(request:Request,origin:string,mode:string){const allowed=new URL(origin);if(mode!=='development'&&allowed.protocol!=='https:')throw Error('ORIGIN_FORBIDDEN');if(request.headers.get('origin')!==allowed.origin||new URL(request.url).host!==allowed.host)throw Error('ORIGIN_FORBIDDEN')}
export function sessionKeys():SessionKeys{const current=process.env.VIDEO_SESSION_SIGNING_KEY,environment=process.env.VIDEO_ENVIRONMENT;if(!current||!environment)throw Error('CONFIGURATION_REQUIRED: session');return{current,environment,keyId:process.env.VIDEO_SESSION_KEY_ID||'v1',previous:process.env.VIDEO_SESSION_PREVIOUS_KEY,previousKeyId:process.env.VIDEO_SESSION_PREVIOUS_KEY_ID}}
export function requestOwner(request:Request){const cookie=request.headers.get('cookie')?.split(';').map(s=>s.trim()).find(s=>s.startsWith('vb-session='))?.slice('vb-session='.length);if(!cookie)throw Error('ACCESS_NOT_FOUND');const keys=sessionKeys();return ownerHash(verifySession(cookie,keys).sid,keys)}
