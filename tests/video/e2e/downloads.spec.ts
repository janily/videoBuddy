import {test,expect,type Page} from '@playwright/test';
const pid='10000000-0000-4000-8000-000000000001',aid='20000000-0000-4000-8000-000000000002',op='30000000-0000-4000-8000-000000000003';
const view={projectId:pid,title:'下载测试',controlVersion:1,briefVersion:0,phase:'ready',understanding:{summary:[],subject:'测试'},preferences:{durationSec:45,aspect:'16:9',language:'zh-CN',styleSlug:null,voiceMode:'none',musicMode:'none',captions:'none'},assets:[],messages:[],currentPreview:null,currentResult:{resultId:crypto.randomUUID(),artifactId:aid,revisionId:crypto.randomUUID(),bundleHash:'a'.repeat(64),createdAt:new Date().toISOString()},previousResult:null,activeConversation:null,activeProduction:null,pendingInputs:[],actions:[],expiresAt:'2030-01-01T00:00:00Z'};
function access(){return {status:200,artifactId:aid,access:{url:`/api/video/projects/${pid}/artifacts/${aid}/file?purpose=download&token=fresh-test`,purpose:'download',filename:'video.mp4',mime:'video/mp4',expiresAt:new Date(Date.now()+180000).toISOString()}}}
async function setup(page:Page){
 await page.route(`**/api/video/projects/${pid}`,r=>r.fulfill({json:view}));
 await page.route('**/access?purpose=play',r=>r.fulfill({json:{url:'/test-video.mp4'}}));
 await page.route('**/test-video.mp4',r=>r.fulfill({status:404}));
 await page.route('**/file?purpose=download&token=*',r=>r.fulfill({body:Buffer.from('protocol download fixture'),headers:{'Content-Type':'video/mp4','Content-Disposition':'attachment; filename="video.mp4"'}}));
}
test('a completed result downloads with a fresh grant and preserves the chat draft',async({page})=>{
 await setup(page);const requests:unknown[]=[];
 await page.route(`**/api/video/projects/${pid}/exports`,r=>{requests.push(r.request().postDataJSON());return r.fulfill({json:access()})});
 await page.goto(`/video/${pid}`);await page.getByRole('textbox').fill('保留草稿');
 await expect(page.getByRole('heading',{name:'视频已经准备好了。'})).toBeVisible();
 const download=page.waitForEvent('download');await page.getByRole('button',{name:'下载视频',exact:true}).click();expect((await download).suggestedFilename()).toBe('video.mp4');
 expect(requests[0]).toMatchObject({artifactId:aid,format:'mp4',schemaVersion:5});await expect(page.getByRole('textbox')).toHaveValue('保留草稿');
});
test('an asynchronous export finishes via SSE and waits for an explicit download',async({page})=>{
 await setup(page);let completed=false;const commands:string[]=[];
 await page.route(`**/api/video/projects/${pid}/exports`,r=>{const input=r.request().postDataJSON();commands.push(input.clientCommandId);return r.fulfill({status:completed?200:202,json:completed?{...access(),access:{...access().access,mime:"application/zip",filename:"source.zip"}}:{status:202,operationId:op,receipt:{schemaVersion:5,commandId:input.clientCommandId,projectId:pid,operationId:op,controlVersion:1,status:'accepted'}}})});
 await page.route(`**/operations/${op}`,r=>r.fulfill({json:{id:op,kind:'export',status:completed?'succeeded':'running',streamEpoch:0}}));
 await page.route(`**/operations/${op}/events`,r=>{completed=true;return r.fulfill({contentType:'text/event-stream',body:`id: 0:0\ndata: ${JSON.stringify({schemaVersion:5,projectId:pid,operationId:op,epoch:0,eventId:crypto.randomUUID(),type:'operation.terminal',createdAt:new Date().toISOString(),payload:{status:'succeeded',retryable:false}})}\n\n`})});
 await page.goto(`/video/${pid}`);await page.getByText('更多', {exact:true}).click();await page.getByRole('button',{name:'下载工程包',exact:true}).click();
 await expect(page.getByRole('status').filter({hasText:'工程包已准备好'})).toBeVisible();expect(new Set(commands).size).toBe(1);
 const saved=await page.evaluate(()=>Object.entries(localStorage).filter(([key])=>key.startsWith('vb-export:')));expect(JSON.stringify(saved)).not.toContain('token');
 const download=page.waitForEvent('download');await page.getByRole('button',{name:'下载工程包',exact:true}).click();await download;expect(new Set(commands).size).toBe(1);
});
test('reload repairs an uncertain export using the original command without polling',async({page})=>{
 await setup(page);const commands:string[]=[];let attempts=0;
 await page.route(`**/api/video/projects/${pid}/exports`,r=>{commands.push(r.request().postDataJSON().clientCommandId);attempts++;return r.fulfill({status:503,json:{error:{code:'OPERATION_START_FAILED'}}})});
 await page.goto(`/video/${pid}`);await page.getByText('更多',{exact:true}).click();await page.getByRole('button',{name:'下载字幕',exact:true}).click();
 await expect(page.getByRole('button',{name:'重新连接下载'})).toBeVisible();await page.reload();
 await expect.poll(()=>attempts).toBeGreaterThanOrEqual(2);await expect(page.getByRole('button',{name:'重新连接下载'})).toBeEnabled();const restoredAttempts=attempts;await page.getByRole('button',{name:'重新连接下载'}).click();await expect.poll(()=>attempts).toBe(restoredAttempts+1);expect(new Set(commands).size).toBe(1);
});
test('a terminal export failure allows a new explicit command and retains the video',async({page})=>{
 await setup(page);const commands:string[]=[];
 await page.route(`**/api/video/projects/${pid}/exports`,r=>{const input=r.request().postDataJSON();commands.push(input.clientCommandId);return r.fulfill({status:202,json:{status:202,operationId:op,receipt:{schemaVersion:5,commandId:input.clientCommandId,projectId:pid,operationId:op,controlVersion:1,status:'completed'}}})});
 await page.route(`**/operations/${op}`,r=>r.fulfill({json:{id:op,kind:'export',status:'failed',streamEpoch:0}}));
 await page.goto(`/video/${pid}`);await page.getByText('更多',{exact:true}).click();const button=page.getByRole('button',{name:'下载工程包',exact:true});await button.click();
 await expect(page.getByRole('status').filter({hasText:'本次导出未完成'})).toBeVisible();await button.click();await expect.poll(()=>commands.length).toBe(2);expect(new Set(commands).size).toBe(2);await expect(page.getByRole('button',{name:'下载视频',exact:true})).toBeEnabled();
});
test('mobile keyboard downloads remain available during production without a third event stream',async({page})=>{
 await setup(page);await page.setViewportSize({width:390,height:844});
 const productionId='40000000-0000-4000-8000-000000000004',conversationId='50000000-0000-4000-8000-000000000005';
 await page.route(`**/api/video/projects/${pid}`,r=>r.fulfill({json:{...view,phase:'rendering',activeProduction:{id:productionId,kind:'render',status:'running',streamEpoch:0},activeConversation:{id:conversationId,kind:'message',status:'running',streamEpoch:0}}}));
 const streams=new Set<string>();await page.route('**/operations/*/events',async r=>{streams.add(r.request().url());await r.fulfill({contentType:'text/event-stream',body:': heartbeat\n\n'})});
 await page.route(`**/api/video/projects/${pid}/exports`,r=>{const input=r.request().postDataJSON();return r.fulfill({status:202,json:{status:202,operationId:op,receipt:{schemaVersion:5,commandId:input.clientCommandId,projectId:pid,operationId:op,controlVersion:1,status:'accepted'}}})});
 let cancelled=false;
 await page.route(`**/operations/${op}`,r=>r.fulfill({json:{id:op,kind:'export',status:cancelled?'cancelled':'reserved',streamEpoch:0}}));
 await page.route(`**/operations/${op}/cancel`,r=>{expect(r.request().postDataJSON().scope).toBe('export');cancelled=true;return r.fulfill({json:{status:'cancelled'}})});
 await page.goto(`/video/${pid}`);await page.getByRole('textbox').fill('继续修改');await page.getByRole('button',{name:'看视频'}).click();
 const summary=page.getByText('更多',{exact:true});await summary.focus();await page.keyboard.press('Enter');await expect(page.getByRole('button',{name:'下载工程包',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'下载工程包',exact:true}).click();await expect(page.getByRole('status').filter({hasText:'任务已保存'})).toBeVisible();expect(streams.size).toBeLessThanOrEqual(2);expect([...streams].some(url=>url.includes(op))).toBe(false);
 await page.getByRole('button',{name:'停止导出'}).click();await expect(page.getByRole('status').filter({hasText:'导出已停止'})).toBeVisible();await expect(page.getByRole('button',{name:'下载视频',exact:true})).toBeEnabled();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.getByRole('button',{name:'聊想法'}).click();await expect(page.getByRole('textbox')).toHaveValue('继续修改');
});
test('a failed SSE reports the actual export restriction while keeping the final result above its preview',async({page})=>{
 await setup(page);await page.route(`**/api/video/projects/${pid}`,r=>r.fulfill({json:{...view,phase:'attention',productionFailure:{operationId:op,errorCode:'QUALITY_BLOCKED',message:'新版本质量检查未通过，已有视频保留。'},currentPreview:{previewId:crypto.randomUUID(),revisionId:crypto.randomUUID(),briefVersion:0,previewArtifactId:crypto.randomUUID(),bundleHash:'a'.repeat(64),scriptHash:'b'.repeat(64),factsHash:'c'.repeat(64),script:['片段文案'],criticalFacts:[],summary:'片段',expiresAt:'2030-01-01T00:00:00Z',state:'ready'}}}));
 let failed=false;
 await page.route(`**/api/video/projects/${pid}/exports`,r=>{const input=r.request().postDataJSON();return r.fulfill({status:202,json:{status:202,operationId:op,receipt:{schemaVersion:5,commandId:input.clientCommandId,projectId:pid,operationId:op,controlVersion:1,status:'accepted'}}})});
 await page.route(`**/operations/${op}`,r=>r.fulfill({json:{id:op,kind:'export',status:failed?'failed':'running',streamEpoch:0}}));
 await page.route(`**/operations/${op}/events`,r=>{failed=true;return r.fulfill({contentType:'text/event-stream',body:`id: 0:0\ndata: ${JSON.stringify({schemaVersion:5,projectId:pid,operationId:op,epoch:0,eventId:crypto.randomUUID(),type:'operation.terminal',createdAt:new Date().toISOString(),payload:{status:'failed',errorCode:'ARCHIVE_ASSET_REDISTRIBUTION_REQUIRED',retryable:false}})}\n\n`})});
 await page.goto(`/video/${pid}`);await expect(page.getByRole('heading',{name:'视频已经准备好了。'})).toBeVisible();await expect(page.getByRole('alert').filter({hasText:'新版本质量检查未通过'})).toBeVisible();
 await page.getByText('更多',{exact:true}).click();await page.getByRole('button',{name:'下载工程包',exact:true}).click();await expect(page.getByRole('status').filter({hasText:'分发许可'})).toBeVisible();await expect(page.getByRole('button',{name:'下载视频',exact:true})).toBeEnabled();
 await page.screenshot({path:'.video-local/ui-downloads-desktop.png'});
 await page.setViewportSize({width:390,height:844});await page.getByRole('button',{name:'看视频'}).click();await page.screenshot({path:'.video-local/ui-downloads-mobile.png'});
});
test('reload replays an unacknowledged explicit export cancellation',async({page})=>{
 await setup(page);const clientCommandId=crypto.randomUUID(),cancelCommandId=crypto.randomUUID();
 await page.addInitScript(({pid,aid,clientCommandId,cancelCommandId})=>localStorage.setItem(`vb-export:${pid}:${aid}`,JSON.stringify({version:1,request:{schemaVersion:5,clientCommandId,artifactId:aid,format:'source_zip'},cancelCommandId})),{pid,aid,clientCommandId,cancelCommandId});
 let cancelled=false;
 await page.route(`**/api/video/projects/${pid}/exports`,r=>{expect(r.request().postDataJSON().clientCommandId).toBe(clientCommandId);return r.fulfill({status:202,json:{status:202,operationId:op,receipt:{schemaVersion:5,commandId:clientCommandId,projectId:pid,operationId:op,controlVersion:1,status:'accepted'}}})});
 await page.route(`**/operations/${op}`,r=>r.fulfill({json:{id:op,kind:'export',status:cancelled?'cancelled':'running',streamEpoch:0}}));
 await page.route(`**/operations/${op}/events`,r=>r.fulfill({contentType:'text/event-stream',body:': heartbeat\n\n'}));
 await page.route(`**/operations/${op}/cancel`,r=>{expect(r.request().postDataJSON()).toMatchObject({clientCommandId:cancelCommandId,scope:'export'});cancelled=true;return r.fulfill({json:{status:'cancelled'}})});
 await page.goto(`/video/${pid}`);await expect(page.getByRole('status').filter({hasText:'导出已停止'})).toBeVisible();expect(cancelled).toBe(true);
});
test('a late failure from an old export cannot replace a newly started operation',async({page})=>{
 await setup(page);const opB='60000000-0000-4000-8000-000000000006';let commands=0,failed=false,hold=true;
 let releaseEvent:()=>void=()=>{},releaseInspect:()=>void=()=>{},inspectArrived:()=>void=()=>{};
 const eventGate=new Promise<void>(resolve=>releaseEvent=resolve),inspectGate=new Promise<void>(resolve=>releaseInspect=resolve),arrival=new Promise<void>(resolve=>inspectArrived=resolve);
 await page.route(`**/api/video/projects/${pid}/exports`,r=>{commands++;const input=r.request().postDataJSON(),id=commands===1?op:opB;return r.fulfill({status:202,json:{status:202,operationId:id,receipt:{schemaVersion:5,commandId:input.clientCommandId,projectId:pid,operationId:id,controlVersion:1,status:'accepted'}}})});
 await page.route(`**/operations/${op}`,async r=>{if(failed&&hold){hold=false;inspectArrived();await inspectGate}await r.fulfill({json:{id:op,kind:'export',status:failed?'failed':'running',streamEpoch:0}})});
 await page.route(`**/operations/${opB}`,r=>r.fulfill({json:{id:opB,kind:'export',status:'running',streamEpoch:0}}));
 await page.route(`**/operations/${op}/events`,async r=>{await eventGate;failed=true;await r.fulfill({contentType:'text/event-stream',body:`id: 0:0\ndata: ${JSON.stringify({schemaVersion:5,projectId:pid,operationId:op,epoch:0,eventId:crypto.randomUUID(),type:'operation.terminal',createdAt:new Date().toISOString(),payload:{status:'failed',errorCode:'ARCHIVE_PRIVATE_DATA',retryable:false}})}\n\n`})});
 await page.route(`**/operations/${opB}/events`,r=>r.fulfill({contentType:'text/event-stream',body:': heartbeat\n\n'}));
 await page.route('**/cancel',r=>r.fulfill({json:{status:'already_completed'}}));
 await page.goto(`/video/${pid}`);await page.getByText('更多',{exact:true}).click();const button=page.getByRole('button',{name:'下载工程包',exact:true});await button.click();await expect(page.getByRole('button',{name:'停止导出'})).toBeEnabled();releaseEvent();await arrival;
 await page.getByRole('button',{name:'停止导出'}).click();await expect(page.getByRole('status').filter({hasText:'本次导出未完成'})).toBeVisible();const newResponse=page.waitForResponse(r=>r.url().endsWith(`/operations/${opB}`));await button.click();await (await newResponse).finished();await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));await expect(page.getByRole('status').filter({hasText:'正在准备工程包'})).toBeVisible();
 const response=page.waitForResponse(r=>r.url().endsWith(`/operations/${op}`));releaseInspect();await (await response).finished();await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));
 await expect(page.getByRole('status').filter({hasText:'私密资料'})).toHaveCount(0);await expect(button).toBeDisabled();await expect(page.getByRole('button',{name:'停止导出'})).toBeVisible();
});
