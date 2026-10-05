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
 const flag=process.argv.slice(2).join(' '),version=flag==='--verify-book-glyph-ambiguity-v1'?'v1':flag==='--verify-book-glyph-ambiguity-v2'?'v2':undefined;
 if(!version)throw Error('BOOK_CAPTION_PROBE_FLAG_REQUIRED');
 const image='sha256:46a3a937735e1f0472fecc8e32b78da99c7da187aa1faac7017c523b92911dfb',path=`docs/engineering/evidence/book-glyph-ambiguity-probe-${version}.json`;
 const report:Record<string,unknown>={executedAt:new Date().toISOString(),status:'started',image,newModelCalls:0,defaultRuntimeChanged:false,formalProductionApproval:false,deliveryEligible:false};
 await claimProbeReport(path,report);const parent=resolve('.video-local/book-caption');await mkdir(parent,{recursive:true});const root=await mkdtemp(join(parent,'probe-')),work=join(root,'work'),output=join(root,'output');await mkdir(work);await mkdir(output);
 const store=new FileStore(root),journal={store,prefix:`projects/${randomUUID()}/operations/${randomUUID()}/media-effects`};report.root=root;report.journalPrefix=journal.prefix;await persistProbeReport(path,report);
 try{
  const env={VIDEO_MEDIA_IMAGE_REF:image,VIDEO_MEDIA_RUNTIME_DIGEST:image.slice(7),VIDEO_MEDIA_TIMEOUT_SECONDS:'60'},samples=[{id:'mashanzheng',text:'洒下适量的水，润湿土壤。'},{id:'patrickhand',text:'Observe growth, care with patience.'}],fonts=[];
  for(const sample of samples){const actual=await readPinnedStyleFont(env,sample.id,{journal});if([...sample.text].some(c=>!/^\s$/.test(c)&&!actual.glyphs.has(c)))throw Error('FONT_GLYPH_MISSING');const font=trustedStyleFont(sample.id);fonts.push({family:font.family,path:font.runtimePath,sha256:font.font.sha256})}
  if(version==='v2'){
   const candidate=resolve('.video-local/font-candidates/longcang-406197b9'),manifest=JSON.parse(await readFile(join(candidate,'acquisition.json'),'utf8'));
   const expected=[['LongCang-Regular.ttf','e5bf2c3f24ef2327c6f136d8f73e2f9dfdf44896fdbeb35a9515f44777bb91bc',5162508],['OFL.txt','603546b7219a94bb59bf8294458194a5010119486354092b66a09a3fd61aeacc',4390],['METADATA.pb','c7d6c01a886b37dcef3c1e89796424f34240647fedac0d37108309c02fa8f3a3',601]] as const;
   for(const [name,digest,bytes] of expected){const data=await readFile(join(candidate,name));if(sha(data)!==digest||data.length!==bytes)throw Error('BOOK_GLYPH_CANDIDATE_CHANGED');await writeFile(join(work,name),data,{flag:'wx'})}
   fonts[0]={family:'Long Cang',path:'/work/LongCang-Regular.ttf',sha256:expected[0][1]};report.candidateAcquisition=manifest;
  }
  const source=await readFile(resolve('runtime/media/book-caption.mjs')),runner=await readFile(resolve('runtime/media/diagnostics/book-glyphs.mjs'));
  report.rendererSha256=sha(source);report.runnerSha256=sha(runner);await persistProbeReport(path,report);
  await writeFile(join(work,'book-caption.mjs'),source,{flag:'wx'});await writeFile(join(work,'runner.mjs'),runner,{flag:'wx'});await writeFile(join(work,'job.json'),JSON.stringify({rendererSha256:sha(source),fonts}),{flag:'wx'});
  const args=['run','--rm','--network','none','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges','--pids-limit','256','--cpus','2','--memory','2g','--memory-swap','2g','--user',`${process.getuid?.()??10001}:${process.getgid?.()??10001}`,'--tmpfs','/tmp:rw,nosuid,size=512m','--mount',`type=bind,src=${work},dst=/work,readonly`,'--mount',`type=bind,src=${output},dst=/output`,image,'node','/work/runner.mjs'];
  const raw=await runOwnedDocker(args,60000,image,undefined,journal),result=JSON.parse(raw);
  if(result.status==='failed'){report.nativeFailure=result;throw Error('BOOK_CAPTION_NATIVE_DIAGNOSTIC_FAILED: '+result.errorCode)}
  if(result.rendererSha256!==sha(source)||result.samples.length!==12||result.comparisons.some((c:{absoluteAlphaDifference:number})=>c.absoluteAlphaDifference<=0))throw Error('BOOK_GLYPH_PROBE_RESULT_INVALID');
  const bytes=await readFile(join(output,'glyph-comparison.png'));if(sha(bytes)!==result.image.sha256||bytes.length!==result.image.bytes)throw Error('BOOK_GLYPH_PROBE_RESULT_CHANGED');
  report.result=result;report.status='actual_font_glyph_comparison_rendered';
 }catch(error){report.status='failed';report.errorCode=String((error as Error).message).slice(0,300);process.exitCode=1}
 finally{report.invocations=await Promise.all((await store.listKeys(journal.prefix,1)).map(async key=>(await store.readFresh(key)).value));await persistProbeReport(path,report);console.log(JSON.stringify({status:report.status,errorCode:report.errorCode,root,newModelCalls:0}))}
}
main().catch(error=>{console.error(String(error.message));process.exitCode=1});
