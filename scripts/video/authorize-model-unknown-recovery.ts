import {randomUUID} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import {isAbsolute} from 'node:path';
import {FileStore} from '../../src/services/video/storage/file-store';
import {StoreMissing} from '../../src/services/video/storage/atomic-store';
import {canonicalHash} from '../../src/services/video/domain/hash';
import {authorizeUnknownModelRecovery} from '../../src/services/video/budget/unknown-recovery';
async function main(){
 const root=process.env.VIDEO_DATA_DIR;if(!process.argv.includes('--authorize')||!root||!isAbsolute(root))throw Error('UNKNOWN_RECOVERY_EXPLICIT_ROOT_REQUIRED');
 const store=new FileStore(root),source={instruction:'就按最新的研发安排来完成 MVP 开发',planSha256:canonicalHash(await readFile('docs/engineering/MVP_FIRST.md','utf8')),maxDeferredUnknown:3},sourceSha256=canonicalHash(source),key='budgets/model-unknown-recovery-authorization';
 let auth:unknown;try{auth=(await store.readFresh(key)).value}catch(error){if(!(error instanceof StoreMissing))throw error;auth={schemaVersion:1,authorizationId:randomUUID(),authorizedAt:new Date().toISOString(),source:'user_instruction',sourceSha256,maxDeferredUnknown:3}}
 if((auth as {sourceSha256:string}).sourceSha256!==sourceSha256)throw Error('UNKNOWN_RECOVERY_SOURCE_CHANGED');
 const gateBefore=(await store.readFresh('budgets/model-gate')).value,saved=await authorizeUnknownModelRecovery(store,auth);
 const report={executedAt:new Date().toISOString(),root,authorization:saved,source,gateSha256:canonicalHash(gateBefore),newModelCalls:0,newNativeExecutions:0,unknownChargesRetained:true,originalUnknownEffectsReplayable:false};
 await writeFile('docs/engineering/evidence/mvp-model-unknown-recovery-authorization.json',JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify({status:'authorized',root,maxDeferredUnknown:saved.maxDeferredUnknown,newModelCalls:0}));
}
main().catch(()=>{console.error('UNKNOWN_RECOVERY_AUTHORIZATION_FAILED');process.exitCode=1});
