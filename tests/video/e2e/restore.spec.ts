import {test,expect,type Page} from '@playwright/test';
const pid='10000000-0000-4000-8000-000000000001',currentId='20000000-0000-4000-8000-000000000002',previousId='60000000-0000-4000-8000-000000000006';
const result=(artifactId:string)=>({artifactId,resultId:crypto.randomUUID(),revisionId:crypto.randomUUID(),bundleHash:'a'.repeat(64),createdAt:new Date().toISOString()});
const initial={projectId:pid,title:'恢复测试',controlVersion:1,briefVersion:0,phase:'ready',understanding:{summary:[],subject:'测试'},preferences:{durationSec:30,aspect:'16:9',language:'zh-CN',styleSlug:null},assets:[],messages:[],currentResult:result(currentId),previousResult:result(previousId),activeConversation:null,activeProduction:null,pendingInputs:[],actions:[],expiresAt:'2030-01-01T00:00:00Z'};
async function setup(page:Page){
 let view=structuredClone(initial);const plays:string[]=[],commands:string[]=[];
 await page.route(`**/api/video/projects/${pid}`,r=>r.fulfill({json:view}));
 await page.route('**/access?purpose=play',r=>{plays.push(r.request().url());return r.fulfill({json:{url:'/restore-fixture.mp4'}})});
 await page.route('**/restore-fixture.mp4',r=>r.fulfill({status:404}));
 const swap=()=>{view={...view,currentResult:view.previousResult,previousResult:view.currentResult,controlVersion:view.controlVersion+1}};
 return{plays,commands,swap,get view(){return view}};
}
async function showHistory(page:Page){await expect(page.getByRole('button',{name:'查看上个结果',exact:true})).toBeVisible({timeout:3000});await page.getByRole('button',{name:'查看上个结果',exact:true}).click()}
test('explicit history restores its saved artifact and keeps the chat draft and fresh downloads',async({page})=>{
 const fixture=await setup(page);
 await page.route(`**/results/${previousId}/restore`,r=>{fixture.commands.push(r.request().postDataJSON().clientCommandId);expect(r.request().postDataJSON()).toMatchObject({schemaVersion:5});fixture.swap();return r.fulfill({json:fixture.view})});
 let downloadArtifact='';await page.route(`**/api/video/projects/${pid}/exports`,r=>{downloadArtifact=r.request().postDataJSON().artifactId;return r.fulfill({json:{status:200,artifactId:previousId,access:{url:`/api/video/projects/${pid}/artifacts/${previousId}/file?purpose=download&token=fixture`,purpose:'download',filename:'video.mp4',mime:'video/mp4',expiresAt:new Date(Date.now()+120000).toISOString()}}})});
 await page.route('**/file?purpose=download&token=*',r=>r.fulfill({body:Buffer.from('restore download protocol fixture'),headers:{'Content-Type':'video/mp4','Content-Disposition':'attachment; filename="video.mp4"'}}));
 await page.goto(`/video/${pid}`);await page.getByRole('textbox').fill('保留恢复时的草稿');await expect(page.getByText('这是上一个结果。',{exact:true})).toHaveCount(0);await showHistory(page);
 await expect(page.getByText('这是上一个结果。',{exact:true})).toBeVisible();await page.getByText('这是上一个结果。',{exact:true}).scrollIntoViewIfNeeded();await page.screenshot({path:'.video-local/ui-restore-desktop.png'});await page.getByRole('button',{name:'恢复这个版本',exact:true}).click();await page.getByRole('button',{name:'确定恢复？当前版本会保留',exact:true}).click();
 await expect.poll(()=>fixture.view.currentResult.artifactId).toBe(previousId);await expect(page.getByText('这是上一个结果。',{exact:true})).toHaveCount(0);await expect(page.getByRole('textbox')).toHaveValue('保留恢复时的草稿');
 const download=page.waitForEvent('download');await page.getByRole('button',{name:'下载视频',exact:true}).click();await download;expect(downloadArtifact).toBe(previousId);expect(fixture.commands).toHaveLength(1);
 const pending=await page.evaluate(()=>Object.entries(localStorage).filter(([key])=>key.startsWith('vb-restore:')));expect(JSON.stringify(pending)).not.toContain('token');
});
test('reload replays the original restore after an acknowledgement loss and never swaps twice',async({page})=>{
 const fixture=await setup(page);let calls=0;
 await page.route(`**/results/${previousId}/restore`,r=>{calls++;fixture.commands.push(r.request().postDataJSON().clientCommandId);if(calls===1){fixture.swap();return r.abort('failed')}return r.fulfill({json:fixture.view})});
 await page.goto(`/video/${pid}`);await showHistory(page);await page.getByRole('button',{name:'恢复这个版本',exact:true}).click();await page.getByRole('button',{name:'确定恢复？当前版本会保留',exact:true}).click();await expect(page.getByRole('button',{name:'重新连接恢复',exact:true})).toBeVisible();
 const stored=await page.evaluate(()=>localStorage.getItem(`vb-restore:${location.pathname.split('/').pop()}`));expect(stored).toBeTruthy();expect(stored).not.toContain('token');
 await page.reload();await expect.poll(()=>calls).toBe(2);await expect(page.getByRole('button',{name:'重新连接恢复',exact:true})).toHaveCount(0);expect(new Set(fixture.commands).size).toBe(1);expect(fixture.view.controlVersion).toBe(2);
});
test('terminal restore failure retains the current result and an explicit new attempt',async({page})=>{
 const fixture=await setup(page);await page.route(`**/results/${previousId}/restore`,r=>{fixture.commands.push(r.request().postDataJSON().clientCommandId);return r.fulfill({status:409,json:{error:{code:'ARTIFACT_INVALID'}}})});
 await page.goto(`/video/${pid}`);await showHistory(page);await page.getByRole('button',{name:'恢复这个版本',exact:true}).click();await page.getByRole('button',{name:'确定恢复？当前版本会保留',exact:true}).click();await expect(page.getByRole('alert').filter({hasText:'当前视频仍保留'})).toBeVisible();await expect(page.getByRole('button',{name:'下载视频',exact:true})).toBeEnabled();
 await page.getByRole('button',{name:'恢复这个版本',exact:true}).click();await page.getByRole('button',{name:'确定恢复？当前版本会保留',exact:true}).click();await expect.poll(()=>fixture.commands.length).toBe(2);expect(new Set(fixture.commands).size).toBe(2);expect(fixture.view.currentResult.artifactId).toBe(currentId);
});
test('mobile history stays inline and blocks restore while production is active',async({page})=>{
 await setup(page);await page.setViewportSize({width:390,height:844});const op='30000000-0000-4000-8000-000000000003',chat='40000000-0000-4000-8000-000000000004',streams=new Set<string>();let restores=0;
 await page.route(`**/api/video/projects/${pid}`,r=>r.fulfill({json:{...initial,phase:'generating',activeProduction:{id:op,kind:'preview',status:'running',streamEpoch:0},activeConversation:{id:chat,kind:'message',status:'running',streamEpoch:0}}}));
 await page.route('**/operations/*/events',r=>{streams.add(r.request().url());return r.fulfill({contentType:'text/event-stream',body:': heartbeat\n\n'})});await page.route('**/restore',r=>{restores++;return r.fulfill({status:500})});
 await page.goto(`/video/${pid}`);await page.getByRole('textbox').fill('继续聊天');await page.getByRole('button',{name:/^画布/,exact:true}).click();const history=page.getByRole('button',{name:'查看上个结果',exact:true});await expect(history).toBeVisible({timeout:3000});await history.click();
 await expect(page.getByRole('button',{name:'恢复这个版本',exact:true})).toBeDisabled();await expect(page.getByText('制作完成后可以恢复这个版本。',{exact:true})).toBeVisible();expect(restores).toBe(0);expect(streams.size).toBeLessThanOrEqual(2);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 const oldVideo=page.locator('video[aria-label="上一个完整视频"]');await expect.poll(async()=>(await oldVideo.boundingBox())?.width||0,{timeout:3000}).toBeGreaterThan(300);await page.getByText('这是上一个结果。',{exact:true}).scrollIntoViewIfNeeded();await page.screenshot({path:'.video-local/ui-restore-mobile.png'});await page.getByRole('button',{name:'聊想法',exact:true}).click();await expect(page.getByRole('textbox')).toHaveValue('继续聊天');
});
test('storage failure prevents dispatch rather than losing a restore command identity',async({page})=>{
 await setup(page);let calls=0;await page.route('**/restore',r=>{calls++;return r.fulfill({status:500})});
 await page.addInitScript(()=>{const original=Storage.prototype.setItem;Storage.prototype.setItem=function(key,value){if(key.startsWith('vb-restore:'))throw Error('storage blocked');return original.call(this,key,value)}});
 await page.goto(`/video/${pid}`);await showHistory(page);await page.getByRole('button',{name:'恢复这个版本',exact:true}).click();await page.getByRole('button',{name:'确定恢复？当前版本会保留',exact:true}).click();await expect(page.getByRole('alert').filter({hasText:'无法保存恢复请求'})).toBeVisible();expect(calls).toBe(0);
});
test('a peer tab notices the restored result and retains its own draft without polling',async({page,context})=>{
 const fixture=await setup(page),peer=await context.newPage(),peerPlays:string[]=[];
 await peer.route(`**/api/video/projects/${pid}`,r=>r.fulfill({json:fixture.view}));await peer.route('**/access?purpose=play',r=>{peerPlays.push(r.request().url());return r.fulfill({json:{url:'/peer-fixture.mp4'}})});await peer.route('**/peer-fixture.mp4',r=>r.fulfill({status:404}));
 await page.route(`**/results/${previousId}/restore`,r=>{fixture.swap();return r.fulfill({json:fixture.view})});
 await page.goto(`/video/${pid}`);await peer.goto(`/video/${pid}`);await peer.getByRole('textbox').fill('另一页的草稿');await showHistory(page);await page.getByRole('button',{name:'恢复这个版本',exact:true}).click();await page.getByRole('button',{name:'确定恢复？当前版本会保留',exact:true}).click();
 await expect(peer.getByText('当前结果有更新。',{exact:true})).toBeVisible({timeout:3000});await expect.poll(()=>peerPlays.some(url=>url.includes(previousId))).toBe(true);await expect(peer.getByRole('textbox')).toHaveValue('另一页的草稿');await peer.close();
});
for(const trigger of ['focus','visibilitychange'])test(`returning ${trigger} refreshes the saved result through ProjectView rather than completion polling`,async({page})=>{
 const fixture=await setup(page);await page.goto(`/video/${pid}`);await expect(page.getByRole('button',{name:'下载视频',exact:true})).toBeVisible();fixture.swap();
 await page.evaluate(trigger=>{if(trigger==='focus')window.dispatchEvent(new Event(trigger));else document.dispatchEvent(new Event(trigger))},trigger);await expect.poll(()=>fixture.plays.some(url=>url.includes(previousId)),{timeout:3000}).toBe(true);
});
for(const failure of ['unavailable','stale'])test(`an acknowledged restore keeps its command until the ${failure} ProjectView is synchronized`,async({page})=>{
 const fixture=await setup(page);let acknowledged=false,blocked=true;const commands:string[]=[];
 await page.route(`**/api/video/projects/${pid}`,r=>acknowledged&&blocked?r.fulfill(failure==='unavailable'?{status:503,json:{error:{code:'SERVICE_UNAVAILABLE'}}}:{json:initial}):r.fulfill({json:fixture.view}));
 await page.route(`**/results/${previousId}/restore`,r=>{const id=r.request().postDataJSON().clientCommandId;if(!commands.includes(id))fixture.swap();commands.push(id);acknowledged=true;return r.fulfill({json:fixture.view})});
 await page.goto(`/video/${pid}`);await showHistory(page);await page.getByRole('button',{name:'恢复这个版本',exact:true}).click();await page.getByRole('button',{name:'确定恢复？当前版本会保留',exact:true}).click();
 await expect(page.getByRole('button',{name:'重新连接恢复',exact:true})).toBeVisible({timeout:3000});await expect(page.getByRole('button',{name:'恢复这个版本',exact:true})).toBeDisabled();expect(await page.evaluate(()=>localStorage.getItem(`vb-restore:${location.pathname.split('/').pop()}`))).toBeTruthy();
 blocked=false;await page.getByRole('button',{name:'重新连接恢复',exact:true}).click();await expect(page.getByText('这是上一个结果。',{exact:true})).toHaveCount(0);expect(new Set(commands).size).toBe(1);expect(fixture.view.controlVersion).toBe(2);
});

test.afterEach(async({page})=>{await expect(page.locator('dialog[open]')).toHaveCount(0)});
