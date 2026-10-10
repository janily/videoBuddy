import {test,expect,type Page} from '@playwright/test';
const pid='10000000-0000-4000-8000-000000000001',current='20000000-0000-4000-8000-000000000002',previous='60000000-0000-4000-8000-000000000006';
const result=(artifactId:string)=>({artifactId,resultId:crypto.randomUUID(),revisionId:crypto.randomUUID(),bundleHash:'a'.repeat(64),createdAt:new Date().toISOString()});
const initial={projectId:pid,title:'反馈目标协议测试',controlVersion:1,briefVersion:0,phase:'ready',understanding:{summary:[],subject:'测试'},preferences:{durationSec:30,aspect:'16:9',language:'zh-CN',styleSlug:null},assets:[],messages:[] as {id:string;clientMessageId:string;role:'user';text:string;status:'completed';ordinal:number;contentVersion:number}[],currentResult:result(current),previousResult:result(previous),activeConversation:null,activeProduction:null,pendingInputs:[],actions:[],expiresAt:'2030-01-01T00:00:00Z'};
async function setup(page:Page){
 let view=structuredClone(initial);const requests:Array<Record<string,unknown>>=[];
 await page.route(`**/api/video/projects/${pid}`,r=>r.fulfill({json:view}));
 await page.route('**/api/video/session',r=>r.fulfill({json:{expiresAt:'2030-01-01'}}));
 await page.route('**/access?purpose=play',r=>r.fulfill({json:{url:'/feedback-protocol-fixture.mp4'}}));
 await page.route('**/feedback-protocol-fixture.mp4',r=>r.fulfill({status:404}));
 return{requests,get view(){return view},archive(messageId:string,text:string){view={...view,controlVersion:view.controlVersion+1,messages:[{id:crypto.randomUUID(),clientMessageId:messageId,role:'user',text,status:'completed',ordinal:1,contentVersion:1}]}},replaceCurrent(){view={...view,controlVersion:view.controlVersion+1,previousResult:view.currentResult,currentResult:result(crypto.randomUUID())}},replaceBoth(){view={...view,controlVersion:view.controlVersion+1,previousResult:result(crypto.randomUUID()),currentResult:result(crypto.randomUUID())}}};
}
test('current and explicitly opened previous results supply the exact whole-film feedback target',async({page})=>{
 const f=await setup(page);await page.route(`**/api/video/projects/${pid}/messages`,r=>{f.requests.push(r.request().postDataJSON());return r.fulfill({status:202,json:{status:'accepted'}})});
 await page.goto(`/video/${pid}`);await expect(page.getByText(/关于当前视频（整片）/)).toBeVisible();
 await page.getByRole('textbox').fill('音乐调小');await page.getByRole('button',{name:'发送',exact:true}).click();await expect.poll(()=>f.requests.length).toBe(1);
 expect(f.requests[0].target).toEqual({artifactId:current,revisionId:f.view.currentResult.revisionId,sourceTimeMs:null});
 await page.getByRole('button',{name:'查看上个结果',exact:true}).click();
 await expect(page.getByText(/关于上个结果（整片）/)).toBeVisible();await page.getByRole('textbox').fill('这版再调整');
 await page.screenshot({path:'.video-local/feedback-target-desktop.png'});
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:'.video-local/feedback-target-mobile.png'});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.getByRole('button',{name:'发送',exact:true}).click();await expect.poll(()=>f.requests.length).toBe(2);
 expect(f.requests[1].target).toEqual({artifactId:previous,revisionId:f.view.previousResult.revisionId,sourceTimeMs:null});
});
test('an uncertain message survives reload and retries its original target and IDs while preserving later typing',async({page})=>{
 const f=await setup(page);await page.route(`**/api/video/projects/${pid}/messages`,r=>{f.requests.push(r.request().postDataJSON());return f.requests.length===1?r.abort('failed'):r.fulfill({status:202,json:{status:'accepted'}})});
 await page.goto(`/video/${pid}`);await page.getByRole('textbox').fill('音乐调小');await page.getByRole('button',{name:'发送',exact:true}).click();
 await expect(page.getByRole('button',{name:'重发上一条'})).toBeEnabled();const first=f.requests[0];f.replaceCurrent();await page.reload();
 await expect(page.getByRole('button',{name:'重发上一条'})).toBeVisible();await page.getByRole('textbox').fill('下一段不能丢');await page.getByRole('button',{name:'重发上一条'}).click();
 await expect.poll(()=>f.requests.length).toBe(2);expect(f.requests[1]).toEqual(first);await expect(page.getByRole('textbox')).toHaveValue('下一段不能丢');
 await expect.poll(()=>page.evaluate(id=>localStorage.getItem(`vb-message:${id}`),pid)).toBeNull();
});
test('failed browser storage prevents dispatch and preserves the draft',async({page})=>{
 const f=await setup(page);await page.addInitScript(()=>{const original=Storage.prototype.setItem;Storage.prototype.setItem=function(key,value){if(key.startsWith('vb-message:'))throw Error('storage unavailable');return original.call(this,key,value)}});
 await page.route(`**/api/video/projects/${pid}/messages`,r=>{f.requests.push(r.request().postDataJSON());return r.fulfill({status:202,json:{}})});
 await page.goto(`/video/${pid}`);await page.getByRole('textbox').fill('保留草稿');await page.getByRole('button',{name:'发送',exact:true}).click();await expect(page.getByRole('status').filter({hasText:'storage unavailable'})).toBeVisible();expect(f.requests).toHaveLength(0);await expect(page.getByRole('textbox')).toHaveValue('保留草稿');
});
test('an unsent draft does not silently retarget a removed result after reload',async({page})=>{
 const f=await setup(page);await page.route(`**/api/video/projects/${pid}/messages`,r=>{f.requests.push(r.request().postDataJSON());return r.fulfill({status:202,json:{}})});
 await page.goto(`/video/${pid}`);await page.getByRole('textbox').fill('针对原视频');f.replaceBoth();await page.reload();
 await expect(page.getByText(/反馈视频已变化，请重新选择/)).toBeVisible();await page.getByRole('button',{name:'发送',exact:true}).click();await expect(page.getByRole('status').filter({hasText:'反馈视频已变化'})).toBeVisible();expect(f.requests).toHaveLength(0);
 await page.getByLabel('完整视频',{exact:true}).focus();await page.getByRole('button',{name:'发送',exact:true}).click();await expect.poll(()=>f.requests.length).toBe(1);expect(f.requests[0].target).toEqual({artifactId:f.view.currentResult.artifactId,revisionId:f.view.currentResult.revisionId,sourceTimeMs:null});
});
test('a late acknowledgement in one tab cannot erase another tab’s newer uncertain message',async({page,context})=>{
 const f=await setup(page);let release:()=>void=()=>{};const gate=new Promise<void>(resolve=>release=resolve);
 await context.route('**/api/video/session',r=>r.fulfill({json:{expiresAt:'2030-01-01'}}));
 await context.route(`**/api/video/projects/${pid}`,r=>r.fulfill({json:f.view}));
 await context.route('**/access?purpose=play',r=>r.fulfill({json:{url:'/feedback-protocol-fixture.mp4'}}));
 await context.route('**/feedback-protocol-fixture.mp4',r=>r.fulfill({status:404}));
 await context.route(`**/api/video/projects/${pid}/messages`,async r=>{const input=r.request().postDataJSON();f.requests.push(input);if(input.text==='消息A'){await gate;await r.fulfill({status:202,json:{status:'accepted'}})}else await r.abort('failed')});
 await page.goto(`/video/${pid}`);await page.getByRole('textbox').fill('消息A');await page.getByRole('button',{name:'发送',exact:true}).click();await expect.poll(()=>f.requests.length).toBe(1);
 f.archive(String(f.requests[0].clientMessageId),'消息A');const peer=await context.newPage();
 try{
  await peer.goto(`/video/${pid}`);await expect(peer.getByRole('paragraph').filter({hasText:/^消息A$/})).toBeVisible();await peer.getByRole('textbox').fill('消息B');await peer.getByRole('button',{name:'发送',exact:true}).click();await expect(peer.getByRole('button',{name:'重发上一条'})).toBeEnabled();
  const before=await peer.evaluate(id=>localStorage.getItem(`vb-message:${id}`),pid);expect(before).toContain('消息B');release();await expect(page.getByRole('button',{name:'发送',exact:true})).toBeEnabled();
  expect(await peer.evaluate(id=>localStorage.getItem(`vb-message:${id}`),pid)).toBe(before);
  await peer.reload();await peer.getByRole('button',{name:'重发上一条'}).click();await expect.poll(()=>f.requests.length).toBe(3);expect(f.requests[2]).toEqual(f.requests[1]);
 }finally{release();await peer.close()}
});
test('selecting another result cannot silently resend an uncertain message against the original result',async({page})=>{
 const f=await setup(page);await page.route(`**/api/video/projects/${pid}/messages`,r=>{f.requests.push(r.request().postDataJSON());return f.requests.length===1?r.abort('failed'):r.fulfill({status:202,json:{status:'accepted'}})});
 await page.goto(`/video/${pid}`);await page.getByRole('textbox').fill('音乐调小');await page.getByRole('button',{name:'发送',exact:true}).click();await expect(page.getByRole('button',{name:'重发上一条'})).toBeEnabled();
 await page.getByRole('button',{name:'查看上个结果',exact:true}).click();await expect(page.getByText(/关于上个结果（整片）/)).toBeVisible();
 await page.getByRole('button',{name:'发送',exact:true}).click();await expect(page.getByRole('status').filter({hasText:'上一条消息还未确认，请先重发上一条'})).toBeVisible();expect(f.requests).toHaveLength(1);
 await page.getByRole('button',{name:'重发上一条'}).click();await expect.poll(()=>f.requests.length).toBe(2);expect(f.requests[1]).toEqual(f.requests[0]);await expect(page.getByRole('textbox')).toHaveValue('音乐调小');
});
test('a stale retry button cannot create a new message after another tab clears the original intent',async({page,context})=>{
 const f=await setup(page);await context.route('**/api/video/session',r=>r.fulfill({json:{expiresAt:'2030-01-01'}}));await context.route(`**/api/video/projects/${pid}`,r=>r.fulfill({json:f.view}));await context.route('**/access?purpose=play',r=>r.fulfill({json:{url:'/feedback-protocol-fixture.mp4'}}));await context.route('**/feedback-protocol-fixture.mp4',r=>r.fulfill({status:404}));
 await context.route(`**/api/video/projects/${pid}/messages`,r=>{f.requests.push(r.request().postDataJSON());return f.requests.length===1?r.abort('failed'):r.fulfill({status:202,json:{status:'accepted'}})});
 await page.goto(`/video/${pid}`);await page.getByRole('textbox').fill('原消息');await page.getByRole('button',{name:'发送',exact:true}).click();await expect(page.getByRole('button',{name:'重发上一条'})).toBeEnabled();const peer=await context.newPage();
 try{await peer.goto(`/video/${pid}`);await peer.getByRole('button',{name:'重发上一条'}).click();await expect.poll(()=>f.requests.length).toBe(2);expect(f.requests[1]).toEqual(f.requests[0]);await expect.poll(()=>peer.evaluate(id=>localStorage.getItem(`vb-message:${id}`),pid)).toBeNull();
 await page.getByRole('button',{name:'重发上一条'}).click();await expect(page.getByRole('status').filter({hasText:'上一条消息的状态已变化，请重新连接'})).toBeVisible();expect(f.requests).toHaveLength(2);
 }finally{await peer.close()}
});
test('an acknowledgement without a result cannot clear identical later typing selected for a new result',async({page})=>{
 const f=await setup(page);let view={...f.view,phase:'collecting',currentResult:null as typeof initial.currentResult|null,previousResult:null as typeof initial.previousResult|null};let release:()=>void=()=>{};const gate=new Promise<void>(resolve=>release=resolve);
 await page.route(`**/api/video/projects/${pid}`,r=>r.fulfill({json:view}));await page.route(`**/api/video/projects/${pid}/messages`,async r=>{f.requests.push(r.request().postDataJSON());await gate;await r.fulfill({status:202,json:{status:'accepted'}})});
 try{await page.goto(`/video/${pid}`);await page.getByRole('textbox').fill('音乐调小');await page.getByRole('button',{name:'发送',exact:true}).click();await expect.poll(()=>f.requests.length).toBe(1);expect(f.requests[0].target).toBeNull();
 view={...view,phase:'ready',controlVersion:2,currentResult:result(current)};await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await expect(page.getByLabel('完整视频',{exact:true})).toBeVisible();await page.getByLabel('完整视频',{exact:true}).focus();await page.getByRole('textbox').fill('音乐调小');release();await expect(page.getByRole('button',{name:'发送',exact:true})).toBeEnabled();await expect(page.getByRole('textbox')).toHaveValue('音乐调小');
 }finally{release()}
});
test('closing the previous version returns chat feedback to the current video',async({page})=>{
 const f=await setup(page);await page.route(`**/api/video/projects/${pid}/messages`,r=>{f.requests.push(r.request().postDataJSON());return r.fulfill({status:202,json:{}})});
 await page.goto(`/video/${pid}`);await page.getByRole('button',{name:'查看上个结果',exact:true}).click();await expect(page.getByText(/关于上个结果（整片）/)).toBeVisible();await page.getByRole('button',{name:'收起上个结果',exact:true}).click();await expect(page.getByText(/关于当前视频（整片）/)).toBeVisible();
 await page.getByRole('textbox').fill('修改现在这版');await page.getByRole('button',{name:'发送',exact:true}).click();await expect.poll(()=>f.requests.length).toBe(1);expect(f.requests[0].target).toEqual({artifactId:current,revisionId:f.view.currentResult.revisionId,sourceTimeMs:null});
});

test.afterEach(async({page})=>{await expect(page.locator('dialog[open]')).toHaveCount(0)});
