import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {isAbsolute} from 'node:path';
import {FileStore} from '../../src/services/video/storage/file-store';
import {canonicalHash} from '../../src/services/video/domain/hash';
import {extendUnknownModelRecovery} from '../../src/services/video/budget/unknown-recovery';
import {claimProbeReport,persistProbeReport} from './helpers/probe-report';
async function main(){
 const root=process.env.VIDEO_DATA_DIR;if(process.argv.slice(2).join(' ')!=='--extend-authorized-mvp-recovery'||!root||!isAbsolute(root))throw Error('MVP_RECOVERY_OPT_IN_REQUIRED');
 const store=new FileStore(root),source={instruction:'不限次数和费用上限；就按最新的研发安排来完成 MVP 开发',planSha256:canonicalHash(await readFile('docs/engineering/MVP_FIRST.md','utf8')),maxDeferredUnknown:8},authorization={schemaVersion:2 as const,authorizationId:randomUUID(),authorizedAt:new Date().toISOString(),source:'user_instruction' as const,sourceSha256:canonicalHash(source),maxDeferredUnknown:8};
 const gateBefore=(await store.readFresh('budgets/model-gate')).value,path='docs/engineering/evidence/mvp-model-recovery-extension.json',report={status:'started',source,authorization,gateSha256:canonicalHash(gateBefore),newModelCalls:0,unknownChargesRetained:true,originalUnknownEffectsReplayable:false};
 await claimProbeReport(path,report);await extendUnknownModelRecovery(store,authorization);if(canonicalHash((await store.readFresh('budgets/model-gate')).value)!==report.gateSha256)throw Error('MVP_RECOVERY_GATE_CHANGED');
 await persistProbeReport(path,{...report,status:'authorized',originalGateUnchanged:true});console.log(JSON.stringify({status:'authorized',maxDeferredUnknown:8,newModelCalls:0}));
}
main().catch(()=>{console.error('MVP_RECOVERY_EXTENSION_FAILED');process.exitCode=1});
