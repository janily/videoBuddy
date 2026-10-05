import {randomUUID} from 'node:crypto';
import {mkdtemp,mkdir,readFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {FileStore} from '../../src/services/video/storage/file-store';
import {canonicalHash} from '../../src/services/video/domain/hash';
import {readPinnedStyleFont} from '../../src/services/video/audio/style-font';
import {styleFontBuildLock} from '../../src/services/video/media/font-catalog';
import {claimProbeReport,persistProbeReport} from './helpers/probe-report';
const exec=promisify(execFile);
async function inspect(image:string){const {stdout}=await exec('docker',['image','inspect',image],{timeout:15000,maxBuffer:1024*1024});return JSON.parse(stdout)[0]}
async function main(){
 if(!process.argv.includes('--verify-built-font-runtime'))throw Error('FONT_RUNTIME_PROBE_FLAG_REQUIRED');
 const clear=process.argv.includes('--verify-clear-handwriting-runtime'),lock=styleFontBuildLock(),buildRoot=resolve(clear?'.video-local/font-builds/longcang-406197b9':'.video-local/font-builds/locked-406197b9-local-base'),manifest=JSON.parse(await readFile(join(buildRoot,'build-inputs.json'),'utf8')),image=(await readFile(join(buildRoot,'image.id'),'utf8')).trim();
 if(!/^sha256:[a-f0-9]{64}$/.test(image)||manifest.baseImage!==lock.baseImage||manifest.fontLockSha256!==canonicalHash(lock)||manifest.baseReference!=='videobuddy-media:font-base-'+lock.baseImage.slice(7))throw Error('FONT_BUILD_CHANGED');
 const [base,current,derived]=await Promise.all([inspect(lock.baseImage),inspect(manifest.baseReference),inspect(image)]);
 if(base.Id!==lock.baseImage||current.Id!==lock.baseImage||derived.Id!==image||canonicalHash(derived.RootFS.Layers.slice(0,base.RootFS.Layers.length))!==canonicalHash(base.RootFS.Layers)||derived.Config.Labels['videobuddy.font-lock-sha256']!==canonicalHash(lock)||derived.Config.Labels['videobuddy.font-base-image']!==lock.baseImage)throw Error('FONT_BUILD_CHANGED');
 const path=clear?'docs/engineering/evidence/clear-handwriting-font-runtime-probe.json':'docs/engineering/evidence/style-font-runtime-probe.json',report:Record<string,unknown>={executedAt:new Date().toISOString(),status:'started',image,baseImage:lock.baseImage,baseReference:manifest.baseReference,baseRootFsPrefixMatches:true,fontLockSha256:canonicalHash(lock),buildManifest:manifest,newModelCalls:0,defaultRuntimeChanged:false,formalProductionApproval:false,deliveryEligible:false};
 await claimProbeReport(path,report);const parent=resolve('.video-local/style-font-runtime');await mkdir(parent,{recursive:true});const root=await mkdtemp(join(parent,'probe-')),store=new FileStore(root),journal={store,prefix:`projects/${randomUUID()}/operations/${randomUUID()}/media-effects`};report.root=root;report.journalPrefix=journal.prefix;await persistProbeReport(path,report);
 const env={VIDEO_MEDIA_IMAGE_REF:image,VIDEO_MEDIA_RUNTIME_DIGEST:image.slice(7),VIDEO_MEDIA_TIMEOUT_SECONDS:'60'},samples=[{id:'mashanzheng',text:'把小种子轻轻放进泥土里。洒下适量的水，润湿土壤。泥土里探出了嫩绿的小芽。观察成长，耐心照料。'},{id:'patrickhand',text:'Observe growth, care with patience. Water the soil gently. October eighth.'}];
 if(clear)samples.push({id:'longcang',text:'把小种子轻轻放进泥土里。洒下适量的水，润湿土壤。泥土里探出了嫩绿的小芽。观察成长，耐心照料。料科米禾'});
 const fonts=[];
 try{
  for(const sample of samples){
   const actual=await readPinnedStyleFont(env,sample.id,{journal}),missing=[...new Set([...sample.text].filter(char=>!actual.glyphs.has(char)&&!/^\s$/.test(char)))];
   const {glyphs,...metadata}=actual;fonts.push({...metadata,glyphCount:glyphs.size,sample:sample.text,missing});report.fonts=fonts;await persistProbeReport(path,report);if(missing.length)throw Error('STYLE_FONT_GLYPH_MISSING');
  }
  report.status='locked_fonts_and_script_glyphs_verified';
 }catch(error){report.status='failed';report.errorCode=String((error as Error).message).slice(0,300);process.exitCode=1}
 finally{
  report.invocations=await Promise.all((await store.listKeys(journal.prefix,1)).map(async key=>(await store.readFresh(key)).value));
  await persistProbeReport(path,report);console.log(JSON.stringify({status:report.status,errorCode:report.errorCode,image,fontCount:fonts.length,newModelCalls:0}));
 }
}
main().catch(error=>{console.error(String(error.message));process.exitCode=1});
