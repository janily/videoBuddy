import {constants} from 'node:fs';
import {access,lstat,open,readFile,realpath,unlink} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {isAbsolute,join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {chromium} from 'playwright';

type Check={name:string;status:'pass'|'fail'|'warning';detail:string};
interface FontFile{buildPath:string;sha256:string;bytes:number}
export function supportedNode(version:string){const [major,minor]=version.replace(/^v/,'').split('.').map(Number);return major===22&&minor>=13}
export function binaryVersion(text:string,name:'ffmpeg'|'ffprobe'){const first=text.split('\n')[0].trim(),match=new RegExp(`^${name} version (\\d+)(?:[.\\s-])`).exec(first);return{first,supported:Boolean(match&&Number(match[1])>=6)}}
export function sandboxPolicy(env:Record<string,string|undefined>,production:boolean){
 const requested=env.VIDEO_UNSAFE_NO_SANDBOX==='1';
 if(env.VIDEO_CHROMIUM_EXECUTABLE_PATH&&(!requested||env.NODE_ENV!=='development'||production))throw Error('CUSTOM_CHROMIUM_FORBIDDEN');
 if(requested&&(production||env.NODE_ENV!=='development'))throw Error('UNSAFE_SANDBOX_FORBIDDEN');
 return{sandbox:!requested,unsafe:requested};
}
export async function inspectFontLock(directory:string){
 const base=resolve(directory),lock=await readFile(join(base,'fonts.lock.json')),parsed=JSON.parse(lock.toString()) as {schemaVersion?:number;fonts?:Array<{font:FontFile;licenseFile:FontFile;metadata:FontFile}>};
 if(parsed.schemaVersion!==1||!Array.isArray(parsed.fonts)||!parsed.fonts.length||parsed.fonts.length>100)throw Error('FONT_LOCK_INVALID');
 let files=0;
 for(const font of parsed.fonts)for(const entry of [font.font,font.licenseFile,font.metadata]){
  if(!entry||typeof entry.buildPath!=='string'||!/^[-A-Za-z0-9_./]+$/.test(entry.buildPath)||!/^[a-f0-9]{64}$/.test(entry.sha256)||!Number.isSafeInteger(entry.bytes)||entry.bytes<1||entry.bytes>64*1024*1024)throw Error('FONT_LOCK_INVALID');
  const path=resolve(base,entry.buildPath);if(!path.startsWith(base+'/'))throw Error('FONT_LOCK_INVALID');
  const stat=await lstat(path);if(!stat.isFile()||stat.isSymbolicLink()||stat.size!==entry.bytes||await realpath(path)!==path)throw Error('FONT_FILE_INVALID');
  if(createHash('sha256').update(await readFile(path)).digest('hex')!==entry.sha256)throw Error('FONT_CHECKSUM_MISMATCH');files++;
 }
 return{fonts:parsed.fonts.length,files,lockHash:createHash('sha256').update(lock).digest('hex')};
}
const canAccess=async(path:string,mode:number)=>access(path,mode).then(()=>true,()=>false);
export async function runDoctor(args=process.argv.slice(2),env:Record<string,string|undefined>=process.env){
 if(args.some(arg=>!['--production','--render'].includes(arg)))throw Error('Usage: doctor.ts [--production] [--render]');
 const production=args.includes('--production')||env.NODE_ENV==='production',render=args.includes('--render'),checks:Check[]=[];
 const add=(name:string,status:Check['status'],detail:string)=>checks.push({name,status,detail});
 let policy={sandbox:true,unsafe:false};try{policy=sandboxPolicy(env,production)}catch{add('sandbox_policy','fail','Unsafe sandbox/custom-browser overrides require explicit development mode and are forbidden in production.')}
 const uid=process.getuid?.(),safeEnv={NODE_ENV:'production' as const,PATH:env.PATH||'/usr/local/bin:/usr/bin:/bin',LANG:'C.UTF-8',LC_ALL:'C.UTF-8'};
 add('node',supportedNode(process.version)?'pass':'fail',`${process.version}; required Node 22.13 or newer in the 22.x line.`);
 add('identity',uid!==undefined&&uid!==0?'pass':policy.unsafe?'warning':'fail',uid===0?'Running as root cannot establish the production Chromium sandbox gate; rerun as videobuddy-render.':uid===undefined?'Unix UID unavailable; production requires Linux.':`Unprivileged UID ${uid}.`);
 if(production)add('linux',process.platform==='linux'?'pass':'fail','Production host must be Linux; Ubuntu 24.04 is the acceptance target.');
 if(render){const forbidden=Object.keys(env).filter(key=>/^(MODEL_|SOURCE_ANALYSIS_|VIDEO_SESSION_|NODE_OPTIONS$|LD_PRELOAD$|LD_LIBRARY_PATH$)/.test(key)&&env[key]);add('render_environment',forbidden.length?'fail':'pass',forbidden.length?'Render environment contains application credentials or process injection settings; use the service allowlist.':'No application credential or process injection variables found.');}
 const versions:Partial<Record<'ffmpeg'|'ffprobe',string>>={};
 for(const name of ['ffmpeg','ffprobe'] as const){
  const executable=env[name==='ffmpeg'?'VIDEO_FFMPEG_PATH':'VIDEO_FFPROBE_PATH']||name;
  const result=spawnSync(executable,['-version'],{encoding:'utf8',timeout:10000,maxBuffer:1024*1024,env:safeEnv});
  const version=binaryVersion(result.stdout||'',name);versions[name]=version.first;
  add(name,result.status===0&&version.supported?'pass':'fail',version.first||`${name} unavailable; install version 6 or newer or configure its absolute binary path.`);
 }
 let fonts:Awaited<ReturnType<typeof inspectFontLock>>|undefined;
 try{fonts=await inspectFontLock(join(process.cwd(),'runtime/fonts'));add('fonts','pass',`${fonts.fonts} pinned fonts and ${fonts.files} font/license/metadata files match bytes and SHA-256.`)}catch{add('fonts','fail','Bundled runtime/fonts files are missing, altered, or their lock is invalid. Restore the reviewed release; no runtime downloads are attempted.')}
 const require=createRequire(import.meta.url);let playwrightVersion:string|undefined;
 try{playwrightVersion=require('playwright/package.json').version;const lock=JSON.parse(await readFile('package-lock.json','utf8')) as {packages:Record<string,{version?:string}>};add('playwright_pin',playwrightVersion===lock.packages['node_modules/playwright']?.version?'pass':'fail',`Installed Playwright ${playwrightVersion}; compare against package-lock.json.`)}catch{add('playwright_pin','fail','Cannot verify the installed Playwright version against package-lock.json.')}
 let chromiumVersion:string|undefined;
 if(policy.unsafe)process.stderr.write('WARNING: explicit development-only unsandboxed check; this is never production evidence.\n');
 if(checks.some(check=>check.name==='sandbox_policy'&&check.status==='fail'))add('chromium','fail','Unsafe production override rejected; browser not launched.');
 else try{
  const browser=await chromium.launch({headless:true,chromiumSandbox:policy.sandbox,env:safeEnv,...(policy.unsafe&&env.VIDEO_CHROMIUM_EXECUTABLE_PATH?{executablePath:env.VIDEO_CHROMIUM_EXECUTABLE_PATH}:{}),timeout:30000,args:['--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1','--force-webrtc-ip-handling-policy=disable_non_proxied_udp']});
  try{chromiumVersion=browser.version();const context=await browser.newContext({serviceWorkers:'block',acceptDownloads:false});await context.route('**/*',route=>route.abort());const page=await context.newPage();await page.setContent('<!doctype html><p>Local sandbox health check</p>');await page.screenshot({type:'png',timeout:10000});await context.close();add('chromium',policy.unsafe?'warning':'pass',`${chromiumVersion}; chromiumSandbox=${policy.sandbox}.`)}finally{await browser.close()}
 }catch{add('chromium','fail','Sandboxed Chromium could not start/render. Install the locked Playwright Chromium and libraries, run as a non-root user, and inspect Ubuntu AppArmor/userns policy. See docs/engineering/local-runtime.md; do not disable the sandbox in production.')}
 const root=env.VIDEO_DATA_DIR;
 if(!root||!isAbsolute(root))add('storage','fail','Set VIDEO_DATA_DIR to an existing absolute persistent directory.');
 else try{
  const stat=await lstat(root);if(!stat.isDirectory()||stat.isSymbolicLink()||await realpath(root)!==root)throw Error();
  const media=join(root,'media'),info=await lstat(media);if(!info.isDirectory()||info.isSymbolicLink())throw Error();
  const test=join(media,`.doctor-${randomUUID()}`),handle=await open(test,'wx',0o600);try{await handle.writeFile('local storage health check');await handle.sync()}finally{await handle.close();await unlink(test)}
  add('storage','pass','Existing media directory supports an exclusive write, fsync, and cleanup.');
  if(render&&production){
   add('read_only_release',!await canAccess(process.cwd(),constants.W_OK)?'pass':'fail','Renderer must not be able to write the release directory.');
   const projects=join(root,'projects'),assets=join(root,'assets');
   const privateState=await lstat(projects).then(()=>true,()=>false);
   const confined=!await canAccess(root,constants.W_OK)&&privateState&&!await canAccess(projects,constants.R_OK)&&!await canAccess(projects,constants.X_OK)&&!await canAccess(assets,constants.W_OK)&&await canAccess(assets,constants.R_OK|constants.X_OK);
   add('render_filesystem',confined?'pass':'fail','Render must traverse the app-owned root, write media, read assets, and have no write to root/assets or read access to projects. Actual asset file permissions and all other state paths require host review.');
  }
 }catch{add('storage','fail','Data/media paths must be real directories with the required service-user permissions; doctor never creates the data hierarchy.')}
 let runtimeDigest:string|null=null;
 if(chromiumVersion&&versions.ffmpeg&&fonts)try{
  const runtimeModule=await import(pathToFileURL(join(process.cwd(),'src/services/video/media/runtime-version.ts')).href) as {runtimeVersion:(chromium:string,ffmpeg:string,fonts:string,format:'png',sandbox:boolean)=>Promise<{runtimeDigest:string}>};
  runtimeDigest=(await runtimeModule.runtimeVersion(chromiumVersion,versions.ffmpeg,fonts.lockHash,'png',policy.sandbox)).runtimeDigest;
  add('runtime_digest',/^[a-f0-9]{64}$/.test(runtimeDigest)?'pass':'fail',runtimeDigest);
 }catch{add('runtime_digest','fail','Cannot compute the production runtime digest. Install the complete runtime release; no substitute digest is reported.')}
 else add('runtime_digest','fail','Unavailable until Chromium, ffmpeg, and the font lock checks succeed.');
 const failed=checks.some(check=>check.status==='fail'),status=failed?'fail':policy.unsafe?'development_unsafe':'pass';
 return{status,unsafeDevelopmentMode:policy.unsafe,productionRequested:production,role:render?'render':'application',checks,runtimeDigest,productionReady:false,hostIsolation:'not_verified: inspect live systemd limits, OS groups, network and filesystem confinement on the target Ubuntu host',paidCalls:0};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)runDoctor().then(report=>{console.log(JSON.stringify(report,null,2));if(report.status==='fail')process.exitCode=1}).catch(()=>{console.error('Doctor failed; use doctor.ts [--production] [--render]. No credentials are printed.');process.exitCode=1});
