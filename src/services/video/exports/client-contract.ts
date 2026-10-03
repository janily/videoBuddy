import {z} from 'zod';
import {ExportRequestSchema} from '@/contracts/video/commands';
const IntentSchema=z.strictObject({version:z.literal(1),request:ExportRequestSchema,cancelCommandId:z.string().uuid().optional()});
export type ExportIntent=z.infer<typeof IntentSchema>;
export function parseExportIntent(raw:string,artifactId:string):ExportIntent|null{
 if(raw.length>4096)return null;
 try{const value=IntentSchema.parse(JSON.parse(raw));return value.request.artifactId===artifactId?value:null}catch{return null}
}
const AccessSchema=z.strictObject({url:z.string().min(1).max(4096),expiresAt:z.string().datetime({offset:true}),mime:z.string().min(1).max(120),filename:z.string().min(1).max(255).refine(value=>!/[\x00-\x1f\x7f/\\]/.test(value)),purpose:z.literal('download')});
export function validateDownloadAccess(value:unknown,projectId:string,artifactId:string,origin:string){
 const access=AccessSchema.parse(value),url=new URL(access.url,origin);
 if(url.origin!==origin||url.username||url.password||url.hash||url.pathname!==`/api/video/projects/${projectId}/artifacts/${artifactId}/file`||url.searchParams.get('purpose')!=='download'||!url.searchParams.get('token')||Date.parse(access.expiresAt)<=Date.now())throw Error('DOWNLOAD_ACCESS_INVALID');
 return access;
}
export const exportLabels={mp4:'视频',poster:'封面',srt:'字幕',treatment:'文案',credits:'来源与许可记录',quality:'质量报告',source_zip:'工程包'} as const;
export function exportFailure(code?:string){
 switch(code){
  case 'EXPORT_NOT_APPLICABLE':return '这支视频没有字幕，无法导出字幕文件。';
  case 'ARCHIVE_ASSET_REDISTRIBUTION_REQUIRED':return '工程包需要确认资料的分发许可，视频仍可下载。';
  case 'ARCHIVE_PRIVATE_DATA':return '工程包包含需要处理的私密资料，视频仍可下载。';
  case 'RESULT_STALE':case 'EXPORT_FENCED':return '视频版本已更新，请刷新后下载当前版本。';
  default:return '本次导出未完成，视频已保留。可以重新导出。';
 }
}
