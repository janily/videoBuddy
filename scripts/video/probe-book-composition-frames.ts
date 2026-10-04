import {createHash,randomUUID} from 'node:crypto';
import {mkdir,readFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {FileStore} from '../../src/services/video/storage/file-store';
import {runOwnedDocker} from '../../src/services/video/media/owned-docker';
import {claimProbeReport,persistProbeReport} from './helpers/probe-report';
const sha=(b:Buffer)=>createHash('sha256').update(b).digest('hex');
async function main(){
 const preview=process.argv.slice(2).join(' ')==='--extract-verified-book-preview-frames';
 if(!preview&&process.argv.slice(2).join(' ')!=='--extract-verified-book-composition-frames')throw Error('BOOK_FRAME_FLAG_REQUIRED');
 const sourcePath=preview?'docs/engineering/evidence/book-preview-postmix-probe.json':'docs/engineering/evidence/book-composition-probe.json',source=JSON.parse(await readFile(sourcePath,'utf8'));
 if(preview){if(source.status!=='exact_new_book_mix_mismatch_ready_for_listening'||!source.sourceStateUnchanged||source.nativeInvocationCountBefore!==source.nativeInvocationCountAfter||!source.root.startsWith(resolve('.video-local/new-theme')+'/'))throw Error('BOOK_PREVIEW_NOT_VERIFIED');}
 const image=preview?'sha256:'+source.context.window.mediaRuntimeDigest:source.image;
 if(!/^sha256:[a-f0-9]{64}$/.test(image))throw Error('BOOK_IMAGE_INVALID');
 if(!preview&&(source.status!=='real_book_composition_and_cold_receipts_verified'||!source.coldReadMatches||!source.sourceStateUnchanged||!source.root.startsWith(resolve('.video-local/book-composition')+'/')))throw Error('BOOK_COMPOSITION_NOT_VERIFIED');
 const film=source.composed.outputPath;if(sha(await readFile(film))!==source.composed.technicalQa.sha256)throw Error('BOOK_FILM_CHANGED');
 const path=preview?'docs/engineering/evidence/book-preview-frame-probe.json':'docs/engineering/evidence/book-composition-frame-probe.json',report:Record<string,unknown>={executedAt:new Date().toISOString(),status:'started',image,filmSha256:source.composed.technicalQa.sha256,sourceReportSha256:sha(await readFile(sourcePath)),newModelCalls:0,deliveryEligible:false,formalProductionApproval:false};await claimProbeReport(path,report);
 const output=join(source.root,preview?'book-preview-review-frames':'review-frames');await mkdir(output);const store=new FileStore(source.root),journal={store,prefix:`projects/${randomUUID()}/operations/${randomUUID()}/media-effects`};report.journalPrefix=journal.prefix;await persistProbeReport(path,report);
 try{
  const producer=String.raw`import hashlib,json,subprocess,sys
assert hashlib.sha256(open('/input/film.mp4','rb').read()).hexdigest()==sys.argv[1]
frames=[]
for frame in [51,405]:
 p='/output/frame-'+str(frame)+'.png'
 subprocess.run(['ffmpeg','-v','error','-xerror','-nostdin','-threads','2','-filter_threads','2','-i','/input/film.mp4','-vf','select=eq(n\\,'+str(frame)+')','-frames:v','1','-y',p],check=True)
 b=open(p,'rb').read();frames.append(dict(frame=frame,pngName=p.split('/')[-1],sha256=hashlib.sha256(b).hexdigest(),bytes=len(b)))
print(json.dumps(dict(frames=frames)))`;
  const raw=await runOwnedDocker(['run','--rm','--network','none','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges','--pids-limit','64','--cpus','2','--memory','512m','--memory-swap','512m','--user',`${process.getuid?.()??10001}:${process.getgid?.()??10001}`,'--mount',`type=bind,src=${film},dst=/input/film.mp4,readonly`,'--mount',`type=bind,src=${output},dst=/output`,image,'python3','-c',producer,report.filmSha256 as string],60000,image,undefined,journal);
  const result=JSON.parse(raw);for(const frame of result.frames){const bytes=await readFile(join(output,frame.pngName));if(sha(bytes)!==frame.sha256||bytes.length!==frame.bytes)throw Error('BOOK_FRAME_CHANGED')}report.result=result;report.output=output;report.status='verified_film_frames_extracted';
 }catch(error){report.status='failed';report.errorCode=String((error as Error).message).split('\n')[0].slice(0,300);process.exitCode=1}
 finally{report.invocations=await Promise.all((await store.listKeys(journal.prefix,1)).map(async key=>(await store.readFresh(key)).value));await persistProbeReport(path,report);console.log(JSON.stringify({status:report.status,errorCode:report.errorCode,output}))}
}
main().catch(error=>{console.error(String(error.message));process.exitCode=1});
