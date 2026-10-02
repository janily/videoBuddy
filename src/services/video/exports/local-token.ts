import{createHmac,timingSafeEqual}from'node:crypto';
interface Scope{projectId:string;artifactId:string;owner:string;purpose:'play'|'download'}
function signature(body:string,key:string){return createHmac('sha256',key).update('video-artifact-v1:').update(body).digest('base64url')}
export function issueArtifactToken(scope:Scope,key:string,now=Date.now()){if(key.length<32)throw Error('CONFIGURATION_REQUIRED');const body=Buffer.from(JSON.stringify({...scope,expiresAt:now+180000})).toString('base64url');return body+'.'+signature(body,key)}
export function verifyArtifactToken(token:string,scope:Scope,key:string,now=Date.now()){
 try{const parts=token.split('.');if(parts.length!==2||token.length>2048)throw Error();const [body,mac]=parts;const expected=Buffer.from(signature(body,key)),actual=Buffer.from(mac);if(expected.length!==actual.length||!timingSafeEqual(expected,actual))throw Error();
  const data=JSON.parse(Buffer.from(body,'base64url').toString());if(!Number.isSafeInteger(data.expiresAt)||data.expiresAt<=now||data.expiresAt>now+180000)throw Error();
  if(data.projectId!==scope.projectId||data.artifactId!==scope.artifactId||data.owner!==scope.owner||data.purpose!==scope.purpose)throw Error();return true;
 }catch{throw Error('ACCESS_NOT_FOUND')}
}
