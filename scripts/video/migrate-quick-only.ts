// Usage: VIDEO_DATA_DIR=/absolute/path npx tsx scripts/video/migrate-quick-only.ts [--apply]
// Stop workers before applying. Default is a read-only report; blocked projects
// require their existing producer/stop state to be reconciled before migration.
import {productionStore} from '../../src/services/video/storage/file-store';
import {ProjectStore} from '../../src/services/video/storage/project-store';
import {migrateQuickOnly} from '../../src/services/video/storage/migrate-quick-only';
async function main(){
 const args=process.argv.slice(2);if(args.some(arg=>arg!=='--apply')||args.length>1)throw Error('Usage: migrate-quick-only.ts [--apply]');
 const report=await migrateQuickOnly(new ProjectStore(productionStore()),{apply:args.includes('--apply')});
 console.log(JSON.stringify({mode:args.includes('--apply')?'apply':'dry-run',projects:report},null,2));
 if(report.some(item=>item.status==='blocked'))process.exitCode=2;
}
main().catch(error=>{console.error(error instanceof Error?error.message:'MIGRATION_FAILED');process.exitCode=1});
