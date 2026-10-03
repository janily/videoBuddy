import {randomBytes,createHash} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import type {Environment} from '../../../src/services/video/config/environment';
export function probeEnvironment(root:string):Environment{
 return{...process.env,VIDEO_ENVIRONMENT:'local-probe',VIDEO_APP_ORIGIN:'http://localhost:3000',VIDEO_SESSION_SIGNING_KEY:randomBytes(32).toString('hex'),VIDEO_DATA_DIR:root,VIDEO_GENERATION_ENABLED:'true',VIDEO_PROJECT_MAX_MODEL_CALLS:'6',VIDEO_PROJECT_MAX_INPUT_TOKENS:'600000',VIDEO_PROJECT_MAX_OUTPUT_TOKENS:'80000',VIDEO_PROJECT_MAX_TTS_CHARACTERS:'1000',VIDEO_PROJECT_MAX_MEDIA_SECONDS:'120',VIDEO_DAILY_MAX_MODEL_CALLS:'6',VIDEO_DAILY_MAX_MEDIA_SECONDS:'120',
 VIDEO_VOICE_IMAGE_REF:'sha256:831c0ff8261e75468b3a6868ca29f5b3fd1eee6b222031912eff4e13071e6e64',VIDEO_VOICE_RUNTIME_DIGEST:'831c0ff8261e75468b3a6868ca29f5b3fd1eee6b222031912eff4e13071e6e64',
 VIDEO_ASR_IMAGE_REF:'sha256:67786e6dbdd6b00f6177441e64272b622f844fc6c69b39970543afa92cc4895c',VIDEO_ASR_RUNTIME_DIGEST:'67786e6dbdd6b00f6177441e64272b622f844fc6c69b39970543afa92cc4895c',
 VIDEO_MEDIA_IMAGE_REF:'sha256:75ffd41e03d738cee7e10914aeaeb2605b9daf213409afec295ccb97bb06c919',VIDEO_MEDIA_RUNTIME_DIGEST:'75ffd41e03d738cee7e10914aeaeb2605b9daf213409afec295ccb97bb06c919',VIDEO_MEDIA_TIMEOUT_SECONDS:'300'};
}
export interface ProbeRequest{model:string;maxTokens?:number;status?:number;usage?:unknown;responseSha256?:string;responseFile?:string;startedAt:string;finishedAt?:string;timeoutMs:number;errorName?:string;evidenceErrorName?:string}
function transportErrorName(error:unknown){return error instanceof Error&&['AbortError','TimeoutError','TypeError'].includes(error.name)?error.name:'TransportError'}
export function recordModelRequests(env:Environment,root:string,maxCalls:number,options:{timeoutMs?:number}={}){
 const timeoutMs=options.timeoutMs??120000;
 if(!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>900000||!Number.isSafeInteger(maxCalls)||maxCalls<1)throw Error('MODEL_PROBE_LIMIT_INVALID');
 const original=globalThis.fetch,provider=new URL(env.MODEL_BASE_URL!),requests:ProbeRequest[]=[],reads:Promise<void>[]=[];
 globalThis.fetch=async(input,init)=>{
  const url=new URL(input instanceof Request?input.url:String(input));
  // Mastra decodes its generated inline image URI through fetch; this is local
  // byte decoding, not an HTTP request or an asset network permission.
  if(url.protocol==='data:'&&/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(url.href)&&url.href.length<=12*1024*1024)return original(input,init);
  if(url.origin!==provider.origin||url.pathname!==provider.pathname.replace(/\/$/,'')+'/chat/completions')throw Error('MODEL_PROBE_UNEXPECTED_DESTINATION');
  if(requests.length>=maxCalls)throw Error('MODEL_PROBE_CALL_LIMIT');
  const body=JSON.parse(String(init?.body||'{}')),entry:ProbeRequest={model:String(body.model),maxTokens:body.max_tokens??body.max_completion_tokens,startedAt:new Date().toISOString(),timeoutMs};requests.push(entry);
  const callerSignal=init?.signal??(input instanceof Request?input.signal:undefined);
  let response:Response;
  try{response=await original(input,{...init,signal:AbortSignal.any([AbortSignal.timeout(timeoutMs),...(callerSignal?[callerSignal]:[])])});entry.status=response.status}
  catch(error){entry.errorName=transportErrorName(error);entry.finishedAt=new Date().toISOString();throw error}
  reads.push((async()=>{
   let text:string;
   try{text=await response.clone().text()}catch(error){entry.errorName=transportErrorName(error);return}finally{entry.finishedAt=new Date().toISOString()}
   try{
   // Private diagnostic data contains responses only, never headers/request credentials.
   const safe=text.replaceAll(env.MODEL_API_KEY||'missing-key','[redacted]'),dir=join(root,'model-diagnostics');await mkdir(dir,{recursive:true,mode:0o700});
   const sha256=createHash('sha256').update(safe).digest('hex'),path=join(dir,sha256+'.json');
   await writeFile(path,safe,{mode:0o600,flag:'wx'}).catch(error=>{if(error.code!=='EEXIST')throw error});
   entry.responseSha256=sha256;entry.responseFile='model-diagnostics/'+sha256+'.json';
   try{entry.usage=JSON.parse(safe).usage}catch{}
   }catch{entry.evidenceErrorName='DiagnosticWriteError'}
  })());return response;
 };
 return{requests,flush:()=>Promise.all(reads),restore:()=>{globalThis.fetch=original}};
}
