import {z} from 'zod';
import {RestoreResultRequestSchema} from '@/contracts/video/commands';
const IntentSchema=z.strictObject({version:z.literal(1),projectId:z.uuid(),artifactId:z.uuid(),request:RestoreResultRequestSchema});
export type RestoreIntent=z.infer<typeof IntentSchema>;
export function parseRestoreIntent(raw:string,projectId:string|undefined):RestoreIntent|null{
 if(!projectId||raw.length>2048)return null;
 try{const parsed=IntentSchema.safeParse(JSON.parse(raw));return parsed.success&&parsed.data.projectId===projectId?parsed.data:null}catch{return null}
}
export function restoreFailure(code:string){return code==='RESULT_STALE'?'当前视频已更新，重新打开上个结果后再试。':code==='ARTIFACT_INVALID'?'这个版本暂时无法恢复，当前视频仍保留。':'无法恢复这个版本，当前视频和草稿已保留。'}
export const ResultNoticeSchema=z.strictObject({schemaVersion:z.literal(5),kind:z.literal('result_restored'),projectId:z.uuid(),controlVersion:z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)});
export function notifyRestoredResult(projectId:string,controlVersion:number){
 if(typeof BroadcastChannel==='undefined')return;
 try{const channel=new BroadcastChannel(`vb-project:${projectId}`);try{channel.postMessage({schemaVersion:5,kind:'result_restored',projectId,controlVersion})}finally{channel.close()}}catch{}
}
