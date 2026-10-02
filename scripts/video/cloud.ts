import {readConfiguration} from '../../src/services/video/config/environment';
import {BlobStore} from '../../src/services/video/storage/blob-store';
import {del} from '@vercel/blob';
import {randomUUID} from 'node:crypto';
if(process.env.RUN_VIDEO_CLOUD_TESTS!=='1') {console.error('BLOCKED: explicit RUN_VIDEO_CLOUD_TESTS=1 authorization required');process.exit(2)}
if(!process.env.BLOB_READ_WRITE_TOKEN||!process.env.VIDEO_ENVIRONMENT){console.error('BLOCKED: BLOB_READ_WRITE_TOKEN and VIDEO_ENVIRONMENT required');process.exit(2)}
const store=new BlobStore(process.env.BLOB_READ_WRITE_TOKEN,`video-v5/${process.env.VIDEO_ENVIRONMENT}`);
const key=`probes/${randomUUID()}`;
try{
 const initial=await Promise.allSettled([store.create(key,{version:1}),store.create(key,{version:99})]);
 if(initial.filter(r=>r.status==='fulfilled').length!==1)throw Error('AT-065 atomic creation failed');
 const current=await store.readFresh<{version:number}>(key);
 const race=await Promise.allSettled([store.cas(key,current.etag,{version:2}),store.cas(key,current.etag,{version:3})]);
 if(race.filter(r=>r.status==='fulfilled').length!==1)throw Error('AT-002 atomic CAS failed');
 const latest=await store.readFresh<{version:number}>(key);if(![2,3].includes(latest.value.version))throw Error('AT-002 fresh read failed');
 console.log(JSON.stringify({probe:'blob-cas-initialize',status:'passed',freshVersion:latest.value.version,remaining:['workflow-claim','workflow-stream-resume','sandbox-detached-stop','cjk-audio','2d-3d-renderer'],configuration:readConfiguration().missing}));
}finally{await del(store.key(key),{token:process.env.BLOB_READ_WRITE_TOKEN})}
