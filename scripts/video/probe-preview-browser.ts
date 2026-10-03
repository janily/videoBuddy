import {spawn} from 'node:child_process';
import {createWriteStream} from 'node:fs';
import {mkdtemp,cp,readFile,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {randomBytes} from 'node:crypto';
import {chromium,expect} from '@playwright/test';
import {FileStore} from '../../src/services/video/storage/file-store';
import {updateJson} from '../../src/services/video/storage/atomic-store';
import type {ProjectControl} from '../../src/contracts/video/project';
import {issueSession,ownerHash} from '../../src/services/video/access/session';
async function main(){
 if(!process.argv.includes('--browser'))throw Error('PREVIEW_BROWSER_OPT_IN_REQUIRED');
 const publication=JSON.parse(await readFile('docs/engineering/evidence/preview-publication-probe.json','utf8'));
 const root=await mkdtemp(join(resolve('.video-local'),'preview-browser-'));
 await cp(join(publication.stateRoot,'projects'),join(root,'projects'),{recursive:true});await cp(join(publication.mediaRoot,'objects'),join(root,'objects'),{recursive:true});
 const keys={current:randomBytes(32).toString('hex'),keyId:'browser-probe',environment:'test'},sid=randomBytes(32).toString('hex'),session=issueSession(keys,Date.now(),sid),projectId=publication.input.projectId;
 await updateJson(new FileStore(root),`projects/${projectId}/control`,(c:ProjectControl)=>({...c,ownerKeyHash:ownerHash(sid,keys)}));
 const origin='http://127.0.0.1:3101',env:NodeJS.ProcessEnv={...process.env,VIDEO_DATA_DIR:root,VIDEO_APP_ORIGIN:origin,VIDEO_SESSION_SIGNING_KEY:keys.current,VIDEO_SESSION_KEY_ID:keys.keyId,VIDEO_ENVIRONMENT:keys.environment,VIDEO_GENERATION_ENABLED:'false'};
 delete env.MODEL_API_KEY;
 const logs=createWriteStream(join(root,'web.log'),{mode:0o600});
 const server=spawn(process.execPath,['node_modules/next/dist/bin/next','dev','--hostname','127.0.0.1','--port','3101'],{env,detached:true,stdio:['ignore','pipe','pipe']});server.stdout.pipe(logs);server.stderr.pipe(logs);
 const closed=new Promise<void>(resolve=>server.once('close',()=>resolve()));
 let browser:Awaited<ReturnType<typeof chromium.launch>>|undefined;
 try{
  let ready=false;const started=Date.now();
  while(Date.now()-started<60000){
   try{if((await fetch(origin+'/video',{signal:AbortSignal.timeout(3000)})).ok){ready=true;break}}catch{}
   await new Promise(resolve=>setTimeout(resolve,500));
  }
  if(!ready)throw Error('PREVIEW_BROWSER_SERVER_UNAVAILABLE');
  browser=await chromium.launch({args:['--autoplay-policy=no-user-gesture-required']});
  const context=await browser.newContext({viewport:{width:1440,height:1000}});await context.addCookies([{name:'vb-session',value:session.token,url:origin,httpOnly:true,sameSite:'Lax'}]);
  const page=await context.newPage();let providerCalls=0;
  let accessRequests=0;page.on('request',request=>{if(request.url().includes('/access?purpose=play'))accessRequests++});
  await page.route('**/*',async route=>{const url=new URL(route.request().url());if(url.origin!==origin){providerCalls++;await route.abort()}else await route.continue()});
  await page.goto(origin+'/video/'+projectId);await expect(page.getByRole('heading',{name:'先看看，这个感觉对不对？'})).toBeVisible();
  await page.waitForFunction(()=>{const video=document.querySelector('video');return video&&video.readyState>=2&&Math.abs(video.duration-11)<.1&&video.videoWidth===1280&&video.videoHeight===720},{},{timeout:20000});
  await page.locator('video').evaluate(video=>{if(!(video instanceof HTMLVideoElement))throw Error('VIDEO_ELEMENT_REQUIRED');return video.play()});await page.waitForFunction(()=>document.querySelector('video')!.currentTime>.25);
  const media=await page.locator('video').evaluate(video=>{if(!(video instanceof HTMLVideoElement))throw Error('VIDEO_ELEMENT_REQUIRED');video.pause();return{duration:video.duration,width:video.videoWidth,height:video.videoHeight,currentTime:video.currentTime,readyState:video.readyState,error:video.error?.code||null}});
  const original=await page.locator('video').elementHandle();if(!original)throw Error('VIDEO_ELEMENT_REQUIRED');
  await page.locator('video').evaluate(video=>{if(!(video instanceof HTMLVideoElement))throw Error('VIDEO_ELEMENT_REQUIRED');video.currentTime=6});
  await page.waitForFunction(()=>Math.abs(document.querySelector('video')!.currentTime-6)<.1);
  const first=accessRequests;
  // Inject the media error event only; renewal and all private MP4 bytes use real HTTP.
  await page.locator('video').dispatchEvent('error');
  await expect.poll(()=>accessRequests).toBeGreaterThan(first);
  await page.waitForFunction(()=>{const v=document.querySelector('video');return v&&v.readyState>=2&&v.paused&&Math.abs(v.currentTime-6)<.1});
  const pausedRecovery=await original.evaluate(video=>({sameElement:document.querySelector('video')===video,time:(video as HTMLVideoElement).currentTime,paused:(video as HTMLVideoElement).paused,playsInline:(video as HTMLVideoElement).playsInline}));
  if(!pausedRecovery.sameElement||!pausedRecovery.playsInline)throw Error('PREVIEW_PLAYBACK_REPLACED');
  await page.locator('video').evaluate(video=>{if(!(video instanceof HTMLVideoElement))throw Error('VIDEO_ELEMENT_REQUIRED');return video.play()});await page.waitForFunction(()=>document.querySelector('video')!.currentTime>6.2);
  await page.locator('video').dispatchEvent('error');const second=accessRequests;
  await page.getByRole('button',{name:'重新载入视频',exact:true}).click();
  await expect.poll(()=>accessRequests).toBeGreaterThan(second);
  await page.waitForFunction(()=>{const v=document.querySelector('video');return v&&v.readyState>=2&&!v.paused&&v.currentTime>6.2});
  const playingRecovery=await original.evaluate(video=>({sameElement:document.querySelector('video')===video,time:(video as HTMLVideoElement).currentTime,paused:(video as HTMLVideoElement).paused}));
  if(!playingRecovery.sameElement)throw Error('PREVIEW_PLAYBACK_REPLACED');
  await page.locator('video').evaluate(video=>{if(video instanceof HTMLVideoElement)video.pause()});
  await expect(page.getByRole('button',{name:'就按这个做 →'})).toBeDisabled();await expect(page.getByRole('textbox')).toHaveCount(1);
  await page.screenshot({path:'docs/engineering/evidence/preview-browser-desktop.png',fullPage:true});
  await page.setViewportSize({width:390,height:844});await page.getByRole('button',{name:'看视频',exact:true}).click();await expect(page.locator('video')).toBeVisible();
  await page.screenshot({path:'docs/engineering/evidence/preview-browser-mobile.png',fullPage:true});
  await page.getByRole('button',{name:'聊想法',exact:true}).click();await expect(page.getByRole('textbox')).toBeVisible();
  if(providerCalls||media.error)throw Error('PREVIEW_BROWSER_MEDIA_FAILED');
  await writeFile('docs/engineering/evidence/preview-browser-probe.json',JSON.stringify({executedAt:new Date().toISOString(),status:'pass',root,projectId,previewId:publication.bundle.previewId,artifactSha256:publication.bundle.previewArtifactSha256,media,pausedRecovery,playingRecovery,accessRequests,providerCalls,singleComposer:true,mobileTabs:true,formalProductionDisabled:true,limits:'Real copied native movie served through actual anonymous access and signed private byte route, decoded and advanced by Chromium. Injected media error events test automatic/manual re-signing with the same video DOM and preserved paused/playing position; all access requests and movie bytes use actual HTTP. Generation disabled and provider key excluded from web; no API mocks or example movie. Diagnostic publication fixture, not fresh whole model creation, approved formal rendering, style or final QA acceptance.'},null,2)+'\n');
  console.log(JSON.stringify({status:'pass',media,providerCalls,formalProductionDisabled:true}));
 }finally{
  await browser?.close();if(server.pid)try{process.kill(-server.pid,'SIGTERM')}catch{}
  await closed;logs.end();
 }
}
main().catch(error=>{console.error(JSON.stringify({status:'fail',errorCode:error.message}));process.exitCode=1});
