import {accessSync,constants,existsSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {readConfiguration} from '../../src/services/video/config/environment';
const config=readConfiguration(),root=process.env.VIDEO_DATA_DIR;
let volume:'ready'|'missing'|'unwritable'='missing';
if(root&&existsSync(root)){try{accessSync(root,constants.R_OK|constants.W_OK);volume='ready'}catch{volume='unwritable'}}
const docker=spawnSync('docker',['info','--format','{{.ServerVersion}}'],{encoding:'utf8',timeout:4000});
let image:'not_configured'|'missing'|'present'|'digest_mismatch'='not_configured';
if(process.env.VIDEO_MEDIA_IMAGE_REF){const result=spawnSync('docker',['image','inspect','--format','{{.Id}}',process.env.VIDEO_MEDIA_IMAGE_REF],{encoding:'utf8',timeout:4000});image=result.status===0?(result.stdout.trim()===process.env.VIDEO_MEDIA_IMAGE_REF&&result.stdout.trim().slice(7)===process.env.VIDEO_MEDIA_RUNTIME_DIGEST?'present':'digest_mismatch'):'missing'}
console.log(JSON.stringify({generationEnabled:config.generationEnabled,missing:config.missing,checks:{volume,docker:docker.status===0?'available':'unavailable',mediaImage:image,worker:'check heartbeat with running worker; doctor never starts a paid job'},realMediaProbe:'not_run_by_doctor'},null,2));
