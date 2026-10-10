/** P0: a fixed, paid-provider-free comparison. Run from the repository root.
 * This reconstructed legacy pipeline is NOT a measurement of a container daemon.
 * The built-in candidate is a prototype; --adapter exercises the real runtime.
 */
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {mkdir,readFile,writeFile,appendFile,stat} from 'node:fs/promises';
import {once} from 'node:events';
import {cpus,release,totalmem} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import type {Browser,Page} from 'playwright';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {chromium}:typeof import('playwright')=require('playwright');

const fixed={shots:4,framesPerShot:72,fps:24,width:1920,height:1080} as const;
const fixture=resolve('docs/engineering/evidence/runtime-bench/scene.html');
type Capture='jpeg'|'png'|'jpeg-fast'|'png-fast';
interface Options{out:string;font:string;chromium?:string;ffmpeg:string;ffprobe:string;preset:string;crf:number;threads:number;capture:Capture;quality:number;repeats:number;unsafe:boolean;adapter?:string;requireGates:boolean}
interface ToolResult{stdout:string;stderr:string;ms:number}
interface Timing{shotsMs:number;captureMs:number|null;concatMs:number;assembleMs:number;totalMs:number}
interface Probe{frames:number;fps:number;durationSec:number;width:number;height:number;codec:string;pixelFormat:string;colorSpace:string;audioCodec:string;audioRate:number;audioChannels:number;bytes:number;sha256:string;tags:Record<string,string>}
interface PipelineResult{outputPath:string;timing:Timing;kind:'reconstructed-legacy-host'|'local-prototype'|'local-runtime-adapter';probe?:Probe;details?:Record<string,unknown>}
/** Adapter contract: no model calls; render exactly the supplied shot clock and
 * assemble with the supplied encoding/label settings, returning actual timings.
 * The harness independently probes and compares the resulting final MP4.
 */
export interface RuntimeBenchInput{sceneHtml:string;scenePath:string;outputDir:string;spec:typeof fixed;encode:{preset:string;crf:number;threads:number;gop:number};capture:Capture;jpegQuality:number;fontPath:string;chromiumExecutable?:string;ffmpegPath:string;ffprobePath:string;unsafeNoSandbox:boolean;labelFilter:string}
export type RuntimeBenchAdapter=(input:RuntimeBenchInput)=>Promise<{outputPath:string;timing:Timing;details?:Record<string,unknown>}>;
const fixtureFontUrl='https://runtime-bench.invalid/font.ttf';
let fixtureFont:Buffer;
let commandLog:string|undefined;
const commands:Array<{binary:string;args:string[];ms:number;exitCode:number|null}>=[];
const elapsed=(start:number)=>Math.round(performance.now()-start);
function parse(args:string[]):Options{
 const o:Options={out:resolve(`docs/engineering/evidence/runtime-bench/runs/${new Date().toISOString().replace(/[:.]/g,'-')}`),font:'',ffmpeg:'ffmpeg',ffprobe:'ffprobe',preset:'faster',crf:20,threads:2,capture:'jpeg',quality:92,repeats:1,unsafe:false,requireGates:false};
 for(let i=0;i<args.length;i++){
  const key=args[i];if(key==='--unsafe-no-sandbox'){o.unsafe=true;continue}if(key==='--require-gates'){o.requireGates=true;continue}
  const value=args[++i];if(!value||value.startsWith('--'))throw Error(`Missing value: ${key}`);
  if(key==='--out')o.out=resolve(value);else if(key==='--font')o.font=resolve(value);else if(key==='--chromium')o.chromium=resolve(value);else if(key==='--ffmpeg')o.ffmpeg=value;else if(key==='--ffprobe')o.ffprobe=value;else if(key==='--preset')o.preset=value;else if(key==='--crf')o.crf=Number(value);else if(key==='--threads')o.threads=Number(value);else if(key==='--capture')o.capture=value as Capture;else if(key==='--jpeg-quality')o.quality=Number(value);else if(key==='--repeats')o.repeats=Number(value);else if(key==='--adapter')o.adapter=resolve(value);else throw Error(`Unknown option: ${key}`);
 }
 if(!/^[-a-zA-Z0-9_/.]+$/.test(o.out))throw Error('Output path must contain only letters, numbers, / . _ - (FFmpeg filter path).');
 if(!o.font||!/^[-a-zA-Z0-9_/.]+$/.test(o.font))throw Error('Pass --font with a readable CJK font path (letters, numbers, / . _ - only).');
 if(!['ultrafast','superfast','veryfast','faster','fast','medium','slow'].includes(o.preset)||!Number.isInteger(o.crf)||o.crf<0||o.crf>30||!Number.isInteger(o.threads)||o.threads<1||o.threads>16||!['jpeg','png','jpeg-fast','png-fast'].includes(o.capture)||!Number.isInteger(o.quality)||o.quality<70||o.quality>100||!Number.isInteger(o.repeats)||o.repeats<1||o.repeats>10)throw Error('Invalid benchmark options.');
 if(o.unsafe&&process.env.NODE_ENV==='production')throw Error('Unsafe benchmark forbidden in production.');
 if(process.getuid?.()===0&&!o.unsafe)throw Error('Root requires explicit --unsafe-no-sandbox for this development benchmark; this cannot certify production.');
 return o;
}
async function shaFile(path:string){const hash=createHash('sha256');for await(const bytes of createReadStream(path))hash.update(bytes);return hash.digest('hex')}
async function tool(binary:string,args:string[],feed?:(input:import('node:stream').Writable,closed:Promise<void>)=>Promise<void>):Promise<ToolResult>{
 const start=performance.now(),child=spawn(binary,args,{stdio:[feed?'pipe':'ignore','pipe','pipe'],signal:AbortSignal.timeout(600000)});let stdout='',stderr='',exitCode:number|null=null;let outputArtifact:{path:string;bytes:number;sha256:string}|undefined;
 child.stdout!.on('data',(part:Buffer)=>{stdout=(stdout+part.toString()).slice(-4*1024*1024)});child.stderr!.on('data',(part:Buffer)=>{stderr=(stderr+part.toString()).slice(-4*1024*1024)});child.stdin?.on('error',()=>{});
 const closed=new Promise<void>((resolve,reject)=>{child.once('error',reject);child.once('close',code=>{exitCode=code;commands.push({binary,args,ms:elapsed(start),exitCode:code});if(code===0)resolve();else reject(Error(`${binary} exited ${code}: ${stderr.slice(-3000)}`))})});
 // Attach the rejection handler before asynchronous screenshots start feeding stdin.
 const observed=closed.then(()=>({ok:true as const}),error=>({ok:false as const,error}));
 try{if(feed){await feed(child.stdin!,closed);child.stdin!.end()}const result=await observed;if(!result.ok)throw result.error;const output=args.at(-1);if(output?.endsWith('.mp4'))outputArtifact={path:output,bytes:(await stat(output)).size,sha256:await shaFile(output)};return{stdout,stderr,ms:elapsed(start)}}catch(error){child.kill('SIGKILL');await observed;throw error}finally{if(commandLog)await appendFile(commandLog,JSON.stringify({binary,args,ms:elapsed(start),exitCode,outputArtifact,stdout:stdout.slice(-20000),stderr:stderr.slice(-80000)})+'\n')}
}
function videoArgs(o:Options){return['-c:v','libx264','-preset',o.preset,'-crf',String(o.crf),'-threads',String(o.threads),'-g',String(fixed.fps*2),'-pix_fmt','yuv420p','-color_primaries','bt709','-color_trc','bt709','-colorspace','bt709','-r',String(fixed.fps)]}
function ff(o:Options,args:string[],feed?:Parameters<typeof tool>[2]){return tool(o.ffmpeg,['-hide_banner','-loglevel','info','-xerror','-y','-threads',String(o.threads),'-filter_threads',String(o.threads),'-filter_complex_threads',String(o.threads),...args],feed)}
function label(o:Options){return`drawtext=fontfile=${o.font}:text=AI生成:fontcolor=white@0.85:fontsize=h*0.026:box=1:boxcolor=black@0.32:boxborderw=10:x=w-tw-w*0.03:y=h*0.03`}
function metadata(){return['-metadata','title=VideoBuddy fixed runtime benchmark','-metadata','comment=AIGC: generated by VideoBuddy','-metadata','aigc=AIGC: generated by VideoBuddy','-movflags','+faststart+use_metadata_tags']}
async function launch(o:Options){
 const env=Object.fromEntries(['PATH','HOME','TMPDIR','LD_LIBRARY_PATH','FONTCONFIG_PATH'].flatMap(key=>process.env[key]?[[key,process.env[key]!]]:[]));
 return chromium.launch({executablePath:o.chromium,chromiumSandbox:!o.unsafe,env,args:['--disable-dev-shm-usage','--disable-background-networking','--host-resolver-rules=MAP * ~NOTFOUND'],timeout:30000});
}
async function openScene(browser:Browser,html:string){const context=await browser.newContext({viewport:{width:fixed.width,height:fixed.height},deviceScaleFactor:1,serviceWorkers:'block',acceptDownloads:false});await context.route('**/*',route=>route.request().url()===fixtureFontUrl&&route.request().method()==='GET'?route.fulfill({status:200,contentType:'font/ttf',body:fixtureFont}):route.abort());const page=await context.newPage();await page.setContent(html);await page.waitForFunction(()=>window.READY===true);await page.evaluate(async()=>{await document.fonts.load('80px "VB Bench"');await document.fonts.ready});return{context,page}}
async function renderAt(page:Page,frame:number){await page.evaluate(t=>window.render(t),frame/fixed.fps)}
async function determinism(page:Page,shot:number,dir:string){
 const frames=[shot*fixed.framesPerShot,shot*fixed.framesPerShot+Math.floor(fixed.framesPerShot/2),(shot+1)*fixed.framesPerShot-1],samples=new Map<number,Buffer>();
 for(const frame of frames){await renderAt(page,frame);samples.set(frame,await page.screenshot({type:'png',animations:'disabled'}))}
 for(const frame of [...frames].reverse()){await renderAt(page,frame);if(!samples.get(frame)!.equals(await page.screenshot({type:'png',animations:'disabled'})))throw Error('NONDETERMINISTIC_SCENE')}
 await writeFile(join(dir,`poster-${shot}.png`),samples.get(frames[1])!);
}
async function baseline(o:Options,html:string,dir:string):Promise<PipelineResult>{
 await mkdir(dir,{recursive:true});const start=performance.now(),shotStart=performance.now();let captureMs=0;
 for(let s=0;s<fixed.shots;s++){
  const browser=await launch(o);try{const{page}=await openScene(browser,html),frames=join(dir,`frames-${s}`);await mkdir(frames);await determinism(page,s,dir);const capture=performance.now();
   for(let f=0;f<fixed.framesPerShot;f++){await renderAt(page,s*fixed.framesPerShot+f);await page.screenshot({path:join(frames,`${String(f).padStart(6,'0')}.png`),type:'png',animations:'disabled'})}captureMs+=elapsed(capture);
  }finally{await browser.close()}
  await ff(o,['-framerate',String(fixed.fps),'-i',join(dir,`frames-${s}/%06d.png`),'-vf',`scale=${fixed.width}:${fixed.height}:flags=lanczos`,...videoArgs(o),'-frames:v',String(fixed.framesPerShot),'-movflags','+faststart',join(dir,`shot-${s}.mp4`)]);
 }
 const shotsMs=elapsed(shotStart),concatStart=performance.now();
 await ff(o,[...Array.from({length:fixed.shots},(_,i)=>['-i',join(dir,`shot-${i}.mp4`)]).flat(),'-filter_complex',Array.from({length:fixed.shots},(_,i)=>`[${i}:v]`).join('')+`concat=n=${fixed.shots}:v=1:a=0[v]`,'-map','[v]',...videoArgs(o),'-frames:v',String(fixed.shots*fixed.framesPerShot),'-movflags','+faststart',join(dir,'sequence.mp4')]);
 const concatMs=elapsed(concatStart),assembleStart=performance.now(),outputPath=join(dir,'final.mp4');
 await ff(o,['-i',join(dir,'sequence.mp4'),'-f','lavfi','-i','anullsrc=r=48000:cl=stereo','-filter_complex',`[0:v]${label(o)}[v]`,'-map','[v]','-map','1:a',...videoArgs(o),'-c:a','aac','-b:a','192k','-ac','2','-ar','48000','-t',String(fixed.shots*fixed.framesPerShot/fixed.fps),...metadata(),outputPath]);
 return{kind:'reconstructed-legacy-host',outputPath,timing:{shotsMs,captureMs,concatMs,assembleMs:elapsed(assembleStart),totalMs:elapsed(start)}};
}
async function prototype(o:Options,html:string,dir:string):Promise<PipelineResult>{
 await mkdir(dir,{recursive:true});const start=performance.now(),shotStart=performance.now(),browser=await launch(o);let captureMs=0;
 try{for(let s=0;s<fixed.shots;s++){
  const{page,context}=await openScene(browser,html);try{await determinism(page,s,dir);const cdp=o.capture.endsWith('-fast')?await context.newCDPSession(page):null,format=o.capture.startsWith('png')?'png':'jpeg',capture=performance.now();
   await ff(o,['-f','image2pipe','-c:v',format==='png'?'png':'mjpeg','-framerate',String(fixed.fps),'-i','-','-vf',`scale=${fixed.width}:${fixed.height}:flags=lanczos,${label(o)}`,...videoArgs(o),'-frames:v',String(fixed.framesPerShot),'-movflags','+faststart',join(dir,`shot-${s}.mp4`)],async(input,closed)=>{
    for(let f=0;f<fixed.framesPerShot;f++){
     await renderAt(page,s*fixed.framesPerShot+f);
     const bytes=cdp?Buffer.from((await cdp.send('Page.captureScreenshot',{format,...(format==='jpeg'?{quality:o.quality}:{}),optimizeForSpeed:true})).data,'base64'):await page.screenshot({type:format,...(format==='jpeg'?{quality:o.quality}:{}),animations:'disabled'});
     if(input.destroyed)throw Error('ENCODER_CLOSED');if(!input.write(bytes))await Promise.race([once(input,'drain'),closed.then(()=>{throw Error('ENCODER_CLOSED')})]);
    }
   });captureMs+=elapsed(capture);
  }finally{await context.close()}
 }}finally{await browser.close()}
 const shotsMs=elapsed(shotStart),assembleStart=performance.now(),outputPath=join(dir,'final.mp4');
 await writeFile(join(dir,'concat.txt'),Array.from({length:fixed.shots},(_,i)=>`file 'shot-${i}.mp4'`).join('\n')+'\n');
 await ff(o,['-f','concat','-safe','0','-i',join(dir,'concat.txt'),'-f','lavfi','-i','anullsrc=r=48000:cl=stereo','-map','0:v','-map','1:a','-c:v','copy','-c:a','aac','-b:a','192k','-ac','2','-ar','48000','-t',String(fixed.shots*fixed.framesPerShot/fixed.fps),...metadata(),outputPath]);
 return{kind:'local-prototype',outputPath,timing:{shotsMs,captureMs,concatMs:0,assembleMs:elapsed(assembleStart),totalMs:elapsed(start)}};
}
async function probe(o:Options,path:string):Promise<Probe>{
 const raw=JSON.parse((await tool(o.ffprobe,['-v','error','-threads',String(o.threads),'-count_frames','-show_streams','-show_format','-of','json',path])).stdout),video=raw.streams.find((s:{codec_type:string})=>s.codec_type==='video'),audio=raw.streams.find((s:{codec_type:string})=>s.codec_type==='audio');
 await ff(o,['-v','error','-i',path,'-f','null','-']);
 const [rateNumerator,rateDenominator]=String(video.avg_frame_rate).split('/').map(Number);
 return{frames:Number(video.nb_read_frames),fps:rateNumerator/rateDenominator,durationSec:Number(video.duration),width:video.width,height:video.height,codec:video.codec_name,pixelFormat:video.pix_fmt,colorSpace:video.color_space,audioCodec:audio?.codec_name,audioRate:Number(audio?.sample_rate),audioChannels:audio?.channels,bytes:(await stat(path)).size,sha256:await shaFile(path),tags:raw.format.tags};
}
async function compare(o:Options,a:PipelineResult,b:PipelineResult,dir:string){
 const start=performance.now();a.probe=await probe(o,a.outputPath);b.probe=await probe(o,b.outputPath);
 const statsPath=join(dir,'ssim-frames.log'),result=await ff(o,['-i',a.outputPath,'-i',b.outputPath,'-filter_complex',`[0:v]setpts=PTS-STARTPTS[a];[1:v]setpts=PTS-STARTPTS[b];[a][b]ssim=stats_file=${statsPath}`,'-an','-f','null','-']);
 const match=[...result.stderr.matchAll(/All:([0-9.]+)/g)].at(-1);if(!match)throw Error('SSIM_RESULT_MISSING');
 const ssim=Number(match[1]),timeRatio=b.timing.totalMs/a.timing.totalMs,sizeRatio=b.probe.bytes/a.probe.bytes;
 const media=(p:Probe)=>p.frames===fixed.shots*fixed.framesPerShot&&p.fps===fixed.fps&&Math.abs(p.durationSec-fixed.shots*fixed.framesPerShot/fixed.fps)<1/fixed.fps&&p.width===fixed.width&&p.height===fixed.height&&p.codec==='h264'&&p.pixelFormat==='yuv420p'&&p.colorSpace==='bt709'&&p.audioCodec==='aac'&&p.audioRate===48000&&p.audioChannels===2&&p.tags.comment==='AIGC: generated by VideoBuddy';
 return{ssim,timeRatio,sizeRatio,verificationMs:elapsed(start),gates:{media:media(a.probe)&&media(b.probe),ssim:ssim>=0.99,time:timeRatio<=0.5,size:sizeRatio<=1.3}};
}
async function optional(path:string){return readFile(path,'utf8').then(value=>value.trim(),()=>null)}
async function inventory(o:Options){
 const ffmpeg=await tool(o.ffmpeg,['-version']),ffprobe=await tool(o.ffprobe,['-version']);let daemon='unavailable';try{daemon=(await tool('docker',['info','--format','{{.ServerVersion}}'])).stdout.trim()}catch{/* Honest reconstructed-baseline label is always retained. */}
 const browser=await launch(o);const browserVersion=browser.version();await browser.close();
 return{node:process.version,platform:process.platform,arch:process.arch,kernel:release(),uid:process.getuid?.(),logicalCpuCount:cpus().length,cpuModel:cpus()[0]?.model,totalMemoryBytes:totalmem(),cgroupCpuMax:await optional('/sys/fs/cgroup/cpu.max'),cgroupMemoryMax:await optional('/sys/fs/cgroup/memory.max'),browserVersion,browserPath:o.chromium||chromium.executablePath(),browserSha256:await shaFile(o.chromium||chromium.executablePath()),playwrightVersion:JSON.parse(await readFile(require.resolve('playwright/package.json'),'utf8')).version,ffmpegVersion:ffmpeg.stdout.split('\n')[0],ffmpegBuildSha256:createHash('sha256').update(ffmpeg.stdout).digest('hex'),ffprobeVersion:ffprobe.stdout.split('\n')[0],containerDaemon:daemon,fontPath:o.font,fontSha256:await shaFile(o.font),unsafeNoSandbox:o.unsafe,productionSandboxVerified:false};
}
const median=(values:number[])=>{const sorted=[...values].sort((a,b)=>a-b),i=Math.floor(sorted.length/2);return sorted.length%2?sorted[i]:(sorted[i-1]+sorted[i])/2};
export async function runRuntimeBenchmark(args=process.argv.slice(2)){
 const o=parse(args);await mkdir(o.out,{recursive:true});commands.length=0;commandLog=join(o.out,'commands.jsonl');try{await stat(join(o.out,'report.json'));throw Error('Output already contains report.json; choose a fresh --out.')}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error}
 if(o.unsafe)console.error('UNSAFE DEVELOPMENT BENCHMARK: Chromium sandbox explicitly disabled. No production sandbox certification.');
 const harness=await readFile(resolve('scripts/video/bench-runtime.ts'));await writeFile(join(o.out,'harness.ts'),harness);
 const environment=await inventory(o),source=await readFile(fixture,'utf8'),font=await readFile(o.font);
 fixtureFont=font;
 const html=source.replace('<body',`<style>@font-face{font-family:'VB Bench';src:url('${fixtureFontUrl}')}</style><body`).replace('"Noto Sans CJK SC"','"VB Bench"');
 const fingerprint={sceneSha256:createHash('sha256').update(source).digest('hex'),harnessSha256:createHash('sha256').update(harness).digest('hex'),spec:fixed,encode:{preset:o.preset,crf:o.crf,threads:o.threads,gop:fixed.fps*2},capture:o.capture,jpegQuality:o.quality,fontSha256:environment.fontSha256};
 const adapter=o.adapter?(await import(pathToFileURL(o.adapter).href)).runRuntimeBenchmark as RuntimeBenchAdapter:undefined;if(o.adapter&&typeof adapter!=='function')throw Error('Adapter must export runRuntimeBenchmark(input).');
 const rounds=[];
 for(let round=0;round<o.repeats;round++){
  const dir=join(o.out,`round-${round+1}`);await mkdir(dir,{recursive:true});let a:PipelineResult|undefined,b:PipelineResult|undefined;
  const candidate=async()=>{const outputDir=join(dir,'candidate');await mkdir(outputDir,{recursive:true});return adapter?{...await adapter({sceneHtml:html,scenePath:fixture,outputDir,spec:fixed,encode:fingerprint.encode,capture:o.capture,jpegQuality:o.quality,fontPath:o.font,chromiumExecutable:o.chromium,ffmpegPath:o.ffmpeg,ffprobePath:o.ffprobe,unsafeNoSandbox:o.unsafe,labelFilter:label(o)}),kind:'local-runtime-adapter' as const}:prototype(o,html,outputDir)};
  console.error(`Round ${round+1}/${o.repeats}: ${round%2?'candidate first':'reconstructed baseline first'}`);
  if(round%2){b=await candidate();a=await baseline(o,html,join(dir,'baseline'))}else{a=await baseline(o,html,join(dir,'baseline'));b=await candidate()}
  const comparison=await compare(o,a,b,dir);rounds.push({order:round%2?'candidate-first':'baseline-first',baseline:a,candidate:b,comparison});
  await writeFile(join(o.out,'checkpoint.json'),JSON.stringify({environment,fingerprint,rounds},null,2)+'\n');console.error(JSON.stringify({round:round+1,...comparison}));
 }
 const totals={baselineMedianMs:median(rounds.map(r=>r.baseline.timing.totalMs)),candidateMedianMs:median(rounds.map(r=>r.candidate.timing.totalMs)),minimumSsim:Math.min(...rounds.map(r=>r.comparison.ssim)),maximumSizeRatio:Math.max(...rounds.map(r=>r.comparison.sizeRatio))};
 const gates={media:rounds.every(r=>r.comparison.gates.media),ssim:totals.minimumSsim>=0.99,time:totals.candidateMedianMs/totals.baselineMedianMs<=0.5,size:totals.maximumSizeRatio<=1.3};
 const report={schemaVersion:1,createdAt:new Date().toISOString(),command:['node','--import','tsx','scripts/video/bench-runtime.ts',...args],environment,fingerprint,adapter:o.adapter?{path:o.adapter,sha256:await shaFile(o.adapter)}:null,scope:{baseline:'reconstructed legacy host pipeline, not a daemon-backed run',candidate:adapter?'runtime adapter':'standalone optimization prototype; T3 runtime not exercised',excludedFromPipelineTiming:['container startup/polling/resource controls','legacy repeated intermediate QA','all common final validation and SSIM (reported separately)','paid models, application scheduling and storage'],fontHandling:'same explicit font served via intercepted fixed URL in browser and used by ffmpeg label; adapter must use identical font bytes',productionCertification:false},totals,gates,p0ComparisonThresholdsMet:Object.values(gates).every(Boolean),productionReady:false,rounds,commands};
 await writeFile(join(o.out,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({report:join(o.out,'report.json'),totals,gates,productionReady:false},null,2));
 if(o.requireGates&&!report.p0ComparisonThresholdsMet)process.exitCode=2;return report;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)runRuntimeBenchmark().catch(error=>{console.error(error instanceof Error?error.message:String(error));process.exitCode=1});

declare global{interface Window{READY:boolean;render:(t:number)=>void}}
