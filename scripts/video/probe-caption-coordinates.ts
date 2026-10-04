import {createHash,randomUUID} from 'node:crypto';
import {mkdtemp,mkdir,readFile,writeFile,lstat} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {FileStore} from '../../src/services/video/storage/file-store';
import {canonicalHash} from '../../src/services/video/domain/hash';
import {loadVerifiedFilmPackage} from '../../src/contracts/video/film-package';
import {readNarrationJson} from '../../src/services/video/audio/narration-package';
import type {FilmPackageStageRecord} from '../../src/services/video/preview/film-package-stage';
import {captionStyleForProfile} from '../../src/services/video/timeline/package';
import {validateCaptionStyle} from '../../src/services/video/media/compose';
import {runOwnedDocker} from '../../src/services/video/media/owned-docker';
import {readDockerInvocation,dockerArgumentsHash} from '../../src/services/video/media/docker-journal';
import {claimProbeReport,persistProbeReport} from './helpers/probe-report';

const producer=String.raw`
import hashlib,json,pathlib,subprocess,sys
cases=json.loads(sys.argv[1]);result=[]
for case in cases:
    w,h=case['width'],case['height']
    argv=['ffmpeg','-hide_banner','-loglevel','error','-nostdin','-threads','1','-filter_threads','1','-f','lavfi','-i',f'color=c=0xf4efe3:s={w}x{h}:r=24','-vf',case['filter'],'-frames:v','1','-pix_fmt','rgb24','-f','rawvideo','pipe:1']
    raw=subprocess.run(argv,check=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=20).stdout
    assert len(raw)==w*h*3
    xs=[];ys=[]
    for p in range(w*h):
        if max(raw[p*3:p*3+3])<180:xs.append(p%w);ys.append(p//w)
    assert xs
    bbox=[min(xs),min(ys),max(xs)+1,max(ys)+1]
    name=case['name']+'.png';path=pathlib.Path('/output')/name
    subprocess.run(['ffmpeg','-hide_banner','-loglevel','error','-nostdin','-threads','1','-filter_threads','1','-f','rawvideo','-pix_fmt','rgb24','-s',f'{w}x{h}','-i','pipe:0','-frames:v','1',str(path)],input=raw,check=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=20)
    result.append(dict(case,bbox=bbox,bboxKind='dark-glyph-and-outline',pngName=name,pngSha256=hashlib.sha256(path.read_bytes()).hexdigest(),pngBytes=path.stat().st_size))
case=next(c for c in cases if c['name']=='landscape-preview')
path=pathlib.Path('/output/actual-picture-caption.png')
subprocess.run(['ffmpeg','-hide_banner','-loglevel','error','-nostdin','-threads','1','-filter_threads','1','-i','/input/picture.mp4','-vf',"select='eq(n,51)',"+case['filter'],'-frames:v','1',str(path)],check=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=25)
print(json.dumps(dict(cases=result,actualPicture={'pngName':path.name,'pngSha256':hashlib.sha256(path.read_bytes()).hexdigest(),'pngBytes':path.stat().st_size,'frame':51})))
`;
async function main(){
 const recover=process.argv.includes('--recover-completed-v2');
 if(!recover&&!process.argv.includes('--diagnostic-v2'))throw Error('DIAGNOSTIC_FLAG_REQUIRED');
 const original=JSON.parse(await readFile('docs/engineering/evidence/new-theme-accounted-audio-preview-probe.json','utf8')),source=original.stages.operation;
 const sourceRoot:string=original.root,projectId:string=source.projectId,revisionId:string=source.revisionId,prefix=`projects/${projectId}`,revisionPrefix=`${prefix}/revisions/${revisionId}/`,sourceStore=new FileStore(sourceRoot);
 const keys=['control','budget','operations/'+source.id,'operations/39b2ac82-b50d-45ca-88ff-91dcc036296a'].map(k=>prefix+'/'+k);
 const snapshot=await Promise.all(keys.map(async key=>({key,sha256:canonicalHash((await sourceStore.readFresh(key)).value)})));
 const stage=(await sourceStore.readFresh<FilmPackageStageRecord>(revisionPrefix+'film-package-v2-stage')).value;
 const frozen=await loadVerifiedFilmPackage(sourceStore,await readNarrationJson(sourceStore,stage.filmSpecRef,revisionPrefix+'film/'),sourceRoot);
 if(frozen.filmSpec.qualityPolicyVersion!=='v5.1-package-1')throw Error('LEGACY_FROZEN_PACKAGE_REQUIRED');
 const picture=(await sourceStore.readFresh<{outputPath:string;technicalQa:{sha256:string}}>(revisionPrefix+'picture-sequence/preview')).value;
 const srt=join(sourceRoot,'composition/429a90ff9afeef2ee7a92eb76bef4b1c2006eb1b53e0adcb1cd0c8e43f5d27f2/subtitles.srt');
 const hash=async(path:string)=>createHash('sha256').update(await readFile(path)).digest('hex'),srtSha256=await hash(srt);
 if(srtSha256!=='a2aa6def31aa3ec631cc188559bfbf8cd65b035224d4f00955bbdfb9e56e31cd'||await hash(picture.outputPath)!==picture.technicalQa.sha256)throw Error('SOURCE_CHANGED');
 const image='sha256:'+frozen.filmSpec.runtimeDigest,cases:Array<{name:string;width:number;height:number;filter:string}>=[];
 for(const [aspect,logical] of [['landscape',{width:1920,height:1080}],['portrait',{width:1080,height:1920}]] as const){
  for(const profile of ['full','preview','probe'] as const){
   const scale=profile==='full'?1:profile==='preview'?2/3:1/6,style=captionStyleForProfile(profile,logical);
   cases.push({name:aspect+'-'+profile,width:logical.width*scale,height:logical.height*scale,filter:`subtitles=filename=/input/subtitles.srt:force_style='${validateCaptionStyle(style)}'`});
  }
 }
 const previous=recover?JSON.parse(await readFile('docs/engineering/evidence/caption-coordinate-runtime-probe-v2.json','utf8')):undefined;
 if(previous&&(previous.sourceProjectId!==projectId||previous.sourceRevisionId!==revisionId||previous.sourceSrtSha256!==srtSha256||previous.sourcePictureSha256!==picture.technicalQa.sha256||previous.runtime!==image||canonicalHash(previous.cases)!==canonicalHash(cases)))throw Error('DIAGNOSTIC_INPUT_CHANGED');
 const reportPath=`docs/engineering/evidence/caption-coordinate-runtime-${recover?'recovery':'probe-v2'}.json`,report:Record<string,unknown>={executedAt:new Date().toISOString(),status:'started',diagnosticOnly:true,deliveryEligible:false,formalProductionApproval:false,newModelCalls:0,newNativeProducers:recover?0:1,sourceProjectId:projectId,sourceRevisionId:revisionId,legacyPolicy:frozen.filmSpec.qualityPolicyVersion,sourceSrtSha256:srtSha256,sourcePictureSha256:picture.technicalQa.sha256,runtime:image,cases};
 await claimProbeReport(reportPath,report);
 const parent=resolve('.video-local/caption-coordinates');await mkdir(parent,{recursive:true});const root:string=previous?previous.root:await mkdtemp(join(parent,'probe-'));
 if(!root.startsWith(parent+'/probe-')||!/^[A-Za-z0-9]{6}$/.test(root.slice((parent+'/probe-').length)))throw Error('DIAGNOSTIC_ROOT_CHANGED');
 const rootStat=await lstat(root);if(!rootStat.isDirectory()||rootStat.isSymbolicLink())throw Error('DIAGNOSTIC_ROOT_CHANGED');
 if(!recover)await mkdir(join(root,'output'));report.root=root;
 const store=new FileStore(root),journal={store,prefix:previous?previous.journalPrefix:`projects/${randomUUID()}/operations/${randomUUID()}/media-effects`};report.journalPrefix=journal.prefix;await persistProbeReport(reportPath,report);
 try{
  const args=['run','--rm','--network','none','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges','--pids-limit','64','--cpus','2','--memory','1g','--memory-swap','1g','--user',`${process.getuid?.()??10001}:${process.getgid?.()??10001}`,'--tmpfs','/tmp:rw,nosuid,size=64m','--mount',`type=bind,src=${srt},dst=/input/subtitles.srt,readonly`,'--mount',`type=bind,src=${picture.outputPath},dst=/input/picture.mp4,readonly`,'--mount',`type=bind,src=${root}/output,dst=/output`,image,'python3','-c',producer,JSON.stringify(cases)];
  let stdout:string;
  if(recover){const receipt=await readDockerInvocation(journal,dockerArgumentsHash(args,image),image);if(receipt.state!=='completed')throw Error('DIAGNOSTIC_PRODUCER_NOT_COMPLETED');stdout=receipt.output!}
  else stdout=await runOwnedDocker(args,90000,image,undefined,journal);
  const results=JSON.parse(stdout) as {cases:Array<{name:string;width:number;height:number;filter:string;bbox:number[];pngName:string;pngSha256:string}>;actualPicture:{pngName:string;pngSha256:string}};
  if(results.cases.length!==cases.length||results.cases.some((entry,i)=>canonicalHash({name:entry.name,width:entry.width,height:entry.height,filter:entry.filter})!==canonicalHash(cases[i])||entry.pngName!==entry.name+'.png'||entry.bbox.length!==4||entry.bbox.some(value=>!Number.isSafeInteger(value)||value<0))||results.actualPicture.pngName!=='actual-picture-caption.png')throw Error('DIAGNOSTIC_OUTPUT_CHANGED');
  for(const aspect of ['landscape','portrait']){
   const full=results.cases.find(c=>c.name===aspect+'-full')!;
   for(const sample of results.cases.filter(c=>c.name.startsWith(aspect+'-'))){
    if(sample.bbox.some((value,index)=>Math.abs(value-full.bbox[index]*sample.width/full.width)>3))throw Error('CAPTION_LAYOUT_REFLOWED');
   }
  }
  for(const entry of [...results.cases,results.actualPicture]){
   const data=await readFile(join(root,'output',entry.pngName));if(createHash('sha256').update(data).digest('hex')!==entry.pngSha256)throw Error('OUTPUT_CHANGED');
   const destination='docs/engineering/evidence/caption-coordinate-'+entry.pngName;
   if(recover){let existing:Buffer|undefined;try{existing=await readFile(destination)}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error}if(existing){if(createHash('sha256').update(existing).digest('hex')!==entry.pngSha256)throw Error('DIAGNOSTIC_OUTPUT_CHANGED');continue}}
   await writeFile(destination,data,{flag:'wx',mode:0o600});
  }
  report.results=results;report.status='logical_caption_coordinates_verified';
 }catch(error){report.status='failed';report.errorCode=String((error as Error).message).slice(0,300);process.exitCode=1}
 finally{
  report.sourceStateUnchanged=(await Promise.all(snapshot.map(async s=>canonicalHash((await sourceStore.readFresh(s.key)).value)===s.sha256))).every(Boolean)&&srtSha256===await hash(srt)&&picture.technicalQa.sha256===await hash(picture.outputPath);
  report.invocations=await Promise.all((await store.listKeys(journal.prefix,1)).map(async key=>(await store.readFresh(key)).value));
  if(!report.sourceStateUnchanged){report.status='failed';process.exitCode=1}
  await persistProbeReport(reportPath,report);console.log(JSON.stringify({status:report.status,sourceStateUnchanged:report.sourceStateUnchanged,newModelCalls:0}));
 }
}
main().catch(error=>{console.error(String(error.message));process.exitCode=1});
