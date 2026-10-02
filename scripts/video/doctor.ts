import {readConfiguration} from '../../src/services/video/config/environment';
const config=readConfiguration();
const groups=[
 ['blob-cas-initialize',['BLOB_READ_WRITE_TOKEN','VIDEO_ENVIRONMENT']],
 ['workflow-claim',['VIDEO_PROBE_BASE_URL','VIDEO_CRON_SECRET']],
 ['workflow-stream-resume',['VIDEO_PROBE_BASE_URL','VIDEO_CRON_SECRET']],
 ['sandbox-detached-stop',['VERCEL_PROJECT_ID','VERCEL_TEAM_ID','VERCEL_TOKEN','VIDEO_SANDBOX_IMAGE_REF']],
 ['cjk-audio',['VIDEO_SANDBOX_IMAGE_REF','VIDEO_SANDBOX_RUNTIME_DIGEST']],
 ['2d-3d-renderer',['VIDEO_SANDBOX_IMAGE_REF','VIDEO_SANDBOX_RUNTIME_DIGEST']],
] as const;
export function probePlatform(){return {generationEnabled:config.generationEnabled,missing:config.missing,probes:groups.map(([id,keys])=>({id,status:'blocked',missing:keys.filter(key=>!process.env[key]),reason:process.env.RUN_VIDEO_CLOUD_TESTS==='1'?'Run the dedicated authorized probe; doctor never incurs cloud charges.':'RUN_VIDEO_CLOUD_TESTS=1 authorization is absent; no real probe executed.'}))}}
console.log(JSON.stringify(probePlatform(),null,2));
