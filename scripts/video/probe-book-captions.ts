import {randomUUID,createHash} from 'node:crypto';
import {mkdir,mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {FileStore} from '../../src/services/video/storage/file-store';
import {runOwnedDocker} from '../../src/services/video/media/owned-docker';
import {trustedStyleFont} from '../../src/services/video/media/font-catalog';
import {readPinnedStyleFont} from '../../src/services/video/audio/style-font';
import {claimProbeReport,persistProbeReport} from './helpers/probe-report';
const sha=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex');
async function main(){
 const flag=process.argv.slice(2).join(' '),version=['v2','v3','v4','v5','v6'].find(version=>flag==='--verify-book-caption-renderer-'+version);
 if(!version)throw Error('BOOK_CAPTION_PROBE_FLAG_REQUIRED');
 const image='sha256:46a3a937735e1f0472fecc8e32b78da99c7da187aa1faac7017c523b92911dfb',path=`docs/engineering/evidence/book-caption-runtime-probe-${version}.json`;
 const report:Record<string,unknown>={executedAt:new Date().toISOString(),status:'started',image,newModelCalls:0,defaultRuntimeChanged:false,formalProductionApproval:false,deliveryEligible:false};
 await claimProbeReport(path,report);const parent=resolve('.video-local/book-caption');await mkdir(parent,{recursive:true});const root=await mkdtemp(join(parent,'probe-')),work=join(root,'work'),output=join(root,'output');await mkdir(work);await mkdir(output);
 const store=new FileStore(root),journal={store,prefix:`projects/${randomUUID()}/operations/${randomUUID()}/media-effects`};report.root=root;report.journalPrefix=journal.prefix;await persistProbeReport(path,report);
 try{
  const env={VIDEO_MEDIA_IMAGE_REF:image,VIDEO_MEDIA_RUNTIME_DIGEST:image.slice(7),VIDEO_MEDIA_TIMEOUT_SECONDS:'60'},samples=[{id:'mashanzheng',text:'洒下适量的水，润湿土壤。'},{id:'patrickhand',text:'Observe growth, care with patience.'}],fonts=[];
  for(const sample of samples){const actual=await readPinnedStyleFont(env,sample.id,{journal});if([...sample.text].some(c=>!/^\s$/.test(c)&&!actual.glyphs.has(c)))throw Error('FONT_GLYPH_MISSING');const font=trustedStyleFont(sample.id);fonts.push({family:font.family,path:font.runtimePath,sha256:font.font.sha256})}
  const source=await readFile(resolve('runtime/media/book-caption.mjs')),runner=await readFile(resolve('runtime/media/diagnostics/book-caption.mjs'));
  report.rendererSha256=sha(source);report.runnerSha256=sha(runner);await persistProbeReport(path,report);
  await writeFile(join(work,'book-caption.mjs'),source,{flag:'wx'});await writeFile(join(work,'runner.mjs'),runner,{flag:'wx'});await writeFile(join(work,'job.json'),JSON.stringify({rendererSha256:sha(source),fonts}),{flag:'wx'});
  const args=['run','--rm','--network','none','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges','--pids-limit','256','--cpus','2','--memory','2g','--memory-swap','2g','--user',`${process.getuid?.()??10001}:${process.getgid?.()??10001}`,'--tmpfs','/tmp:rw,nosuid,size=512m','--mount',`type=bind,src=${work},dst=/work,readonly`,'--mount',`type=bind,src=${output},dst=/output`,image,'node','/work/runner.mjs'];
  const raw=await runOwnedDocker(args,60000,image,undefined,journal),result=JSON.parse(raw);
  if(result.status==='failed'){report.nativeFailure=result;throw Error('BOOK_CAPTION_NATIVE_DIAGNOSTIC_FAILED: '+result.errorCode)}
  if(result.rendererSha256!==sha(source)||result.cases.length!==2)throw Error('BOOK_CAPTION_PROBE_RESULT_INVALID');
  for(const sample of result.cases)for(const frame of sample.results){if(!/^(chinese|english)-\d+\.png$/.test(frame.pngName))throw Error('BOOK_CAPTION_PROBE_RESULT_INVALID');const bytes=await readFile(join(output,frame.pngName));if(sha(bytes)!==frame.pngSha256||bytes.length!==frame.pngBytes)throw Error('BOOK_CAPTION_PROBE_RESULT_CHANGED')}
  report.result=result;report.status='rendered_and_reverse_order_verified';
 }catch(error){report.status='failed';report.errorCode=String((error as Error).message).slice(0,300);process.exitCode=1}
 finally{report.invocations=await Promise.all((await store.listKeys(journal.prefix,1)).map(async key=>(await store.readFresh(key)).value));await persistProbeReport(path,report);console.log(JSON.stringify({status:report.status,errorCode:report.errorCode,root,newModelCalls:0}))}
}
main().catch(error=>{console.error(String(error.message));process.exitCode=1});
