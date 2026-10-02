import { readConfiguration } from '@/services/video/config/environment';
export async function POST() {
  const config = readConfiguration();
  if (config.missing.includes('VIDEO_SESSION_SIGNING_KEY')) return Response.json({error:{code:'CONFIGURATION_REQUIRED',message:'匿名访问凭证尚未配置，草稿已保留。',retryable:false,requestId:crypto.randomUUID()}},{status:503,headers:{'Cache-Control':'private, no-store'}});
  return Response.json({error:{code:'CONFIGURATION_REQUIRED',message:'项目存储尚未配置，草稿已保留。',retryable:false,requestId:crypto.randomUUID()}},{status:503,headers:{'Cache-Control':'private, no-store'}});
}
