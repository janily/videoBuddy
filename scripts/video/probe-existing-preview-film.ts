import type {ObjectRef} from '../../src/contracts/video/domain';
import {readNarrationJson} from '../../src/services/video/audio/narration-package';
import {createHash,randomUUID} from 'node:crypto';
import {readFile,mkdir,mkdtemp,copyFile} from 'node:fs/promises';
import {dirname,join,resolve} from 'node:path';
import {FileStore} from '../../src/services/video/storage/file-store';
import {canonicalHash} from '../../src/services/video/domain/hash';
import {runOwnedDocker} from '../../src/services/video/media/owned-docker';
import {validateVideoProbe} from '../../src/services/video/media/technical-qa';
import {parseLoudnessReport,classifyLoudness} from '../../src/services/video/audio/loudness';
import {verifyPostMixNarration} from '../../src/services/video/audio/postmix-asr';
import type {VerifiedNarrationManifest} from '../../src/services/video/audio/asr';
import type {NarrationPlan} from '../../src/services/video/audio/narration';
import {claimProbeReport,persistProbeReport} from './helpers/probe-report';
const decode=`import subprocess,json
path='/input/final.mp4'
probe=json.loads(subprocess.check_output(['ffprobe','-v','error','-count_frames','-show_entries','stream=codec_type,codec_name,width,height,avg_frame_rate,nb_read_frames,pix_fmt,color_primaries,color_transfer,color_space,sample_rate,channels:format=duration','-of','json',path]))
subprocess.run(['ffmpeg','-nostdin','-v','error','-xerror','-threads','2','-filter_threads','2','-i',path,'-map','0','-f','null','-'],check=True)
loudness=subprocess.run(['ffmpeg','-hide_banner','-nostdin','-nostats','-v','info','-i',path,'-map','0:a:0','-vn','-sn','-dn','-af','loudnorm=I=-14:TP=-1.2:LRA=11:print_format=json','-f','null','-'],capture_output=True,check=True).stderr.decode()
if len(loudness)>32768:raise RuntimeError('LOUDNESS_REPORT_LIMIT')
print(json.dumps({'probe':probe,'decoded':True,'loudness':loudness}))`;
async function main(){
 if(!process.argv.includes('--existing-film-remainder'))throw Error('EXPLICIT_DIAGNOSTIC_REQUIRED');
 const source=JSON.parse(await readFile('docs/engineering/evidence/accounted-preview-postmix-probe.json','utf8'));
 if(source.status!=='existing_evidence_read'||source.lines[1]?.status!=='ASR_MISMATCH'||source.lines.slice(2).some((l:{status:string})=>l.status!=='not_reached'))throw Error('KNOWN_UNREACHED_LINES_REQUIRED');
 const store=new FileStore(source.root),prefix=`projects/${source.projectId}`,keys=[prefix+'/control',prefix+'/budget',prefix+'/operations/'+source.operationId],before=await Promise.all(keys.map(async key=>canonicalHash((await store.readFresh(key)).value)));
 const filmBytes=await readFile(source.filmPath);if(createHash('sha256').update(filmBytes).digest('hex')!==source.filmSha256)throw Error('FILM_CHANGED');
 const parent=resolve('.video-local/existing-preview-film');await mkdir(parent,{recursive:true});const root=await mkdtemp(join(parent,'probe-')),operationId=randomUUID(),journal={store,prefix:prefix+'/operations/'+operationId+'/media-effects'},outputPath=join(root,'composition','existing','final.mp4');
 await mkdir(dirname(outputPath),{recursive:true});await copyFile(source.filmPath,outputPath);
 const voice=(await store.readFresh<{planRef:ObjectRef;verifiedRef:ObjectRef}>(prefix+'/revisions/'+source.revisionId+'/voice-stage')).value;
 const original=JSON.parse(await readFile('docs/engineering/evidence/new-theme-accounted-audio-preview-probe.json','utf8'));if(canonicalHash(voice)!==canonicalHash(original.stages.stageRecords['voice-stage']))throw Error('VOICE_STAGE_CHANGED');
 const revisionPrefix=prefix+'/revisions/'+source.revisionId+'/',plan=await readNarrationJson(store,voice.planRef,revisionPrefix) as NarrationPlan,verified=await readNarrationJson(store,voice.verifiedRef,revisionPrefix) as VerifiedNarrationManifest;
 const mediaDigest='75ffd41e03d738cee7e10914aeaeb2605b9daf213409afec295ccb97bb06c919',asrDigest='caa3fca3e3e6866dab7351346367768db612bb411f06fbd4a7a44f767747f5d4',image='sha256:'+mediaDigest,reportPath='docs/engineering/evidence/existing-preview-film-remainder-probe.json',report:{[key:string]:unknown}={executedAt:new Date().toISOString(),root,sourceRoot:source.root,projectId:source.projectId,sourceOperationId:source.operationId,diagnosticOperationId:operationId,filmSha256:source.filmSha256,filmBytes:filmBytes.length,fullPlanSha256:canonicalHash(plan),voiceManifestSha256:canonicalHash(verified),mediaRuntimeDigest:mediaDigest,asrRuntimeDigest:asrDigest,decoderSourceSha256:createHash('sha256').update(decode).digest('hex'),status:'started',technicalProbeOnly:true,deliveryEligible:false,scope:'Read-only technical QA and independently extract/recognize only never-reached mixed lines 3 and 4. Original line 2 remains ASR_MISMATCH awaiting its own listening fact. No publication, source overwrite or model request.'};
 await claimProbeReport(reportPath,report);
 try{
 const decoded=JSON.parse(await runOwnedDocker(['run','--rm','--network','none','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges','--pids-limit','64','--cpus','2','--memory','1g','--memory-swap','1g','--user',`${process.getuid?.()??10001}:${process.getgid?.()??10001}`,'--mount',`type=bind,src=${outputPath},dst=/input/final.mp4,readonly`,image,'python3','-c',decode],90000,image,undefined,journal));
 report.technicalQa={...validateVideoProbe(decoded.probe,{width:1280,height:720,durationSec:20,fps:24,audio:true,audioChannels:2}),decoded:decoded.decoded,sha256:source.filmSha256};const levels=parseLoudnessReport(decoded.loudness);report.loudness={...levels,status:classifyLoudness(levels,false)};
 const ids=plan.lines.slice(2).map(line=>line.lineId);if(ids.length!==2||ids.some(id=>!verified.lines.some(line=>line.lineId===id)))throw Error('LINE_SCOPE_CHANGED');
 const env={VIDEO_MEDIA_IMAGE_REF:image,VIDEO_MEDIA_RUNTIME_DIGEST:mediaDigest,VIDEO_MEDIA_TIMEOUT_SECONDS:'180',VIDEO_ASR_IMAGE_REF:'sha256:'+asrDigest,VIDEO_ASR_RUNTIME_DIGEST:asrDigest,VIDEO_ASR_MODEL:'Systran/faster-whisper-medium'};
 report.remainder=await verifyPostMixNarration(root,{outputPath,sha256:source.filmSha256,durationMs:20000,technicalQa:'pass'},{...plan,lines:plan.lines.filter(line=>ids.includes(line.lineId))},{...verified,lines:verified.lines.filter(line=>ids.includes(line.lineId))},env,undefined,{journal});report.status='remainder_verified';
 }catch(error){report.status='blocked';report.errorCode=(error as Error).message;process.exitCode=1}
 report.sourceStateUnchanged=canonicalHash(before)===canonicalHash(await Promise.all(keys.map(async key=>canonicalHash((await store.readFresh(key)).value))));await persistProbeReport(reportPath,report);console.log(JSON.stringify(report));
}
main().catch(error=>{console.error(JSON.stringify({status:'blocked',errorCode:error.message}));process.exitCode=1});
