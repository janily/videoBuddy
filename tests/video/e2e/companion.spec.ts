import{test,expect}from'@playwright/test';
const projectId='10000000-0000-4000-8000-000000000001';
const view={projectId,title:'测试项目',controlVersion:1,briefVersion:0,phase:'collecting',understanding:{summary:['这是经过整理的想法'],subject:'测试'},preferences:{durationSec:45,aspect:'16:9',language:'zh-CN',styleSlug:null,voiceMode:'tts',musicMode:'composed',captions:'auto'},assets:[],messages:[],currentPreview:null,currentResult:null,previousResult:null,activeConversation:null,activeProduction:null,pendingInputs:[],actions:[],expiresAt:'2030-01-01T00:00:00Z'};
test('AT-023 submitting one draft never clears typing made while request is pending',async({page})=>{
 await page.route('**/api/video/session',r=>r.fulfill({json:{expiresAt:'2030-01-01'}}));
 await page.route('**/api/video/projects',r=>r.fulfill({json:{projectId,controlVersion:1}}));
 await page.route(`**/api/video/projects/${projectId}`,r=>r.fulfill({json:view}));
 let release:()=>void=()=>{};const pending=new Promise<void>(resolve=>release=resolve);
 await page.route(`**/api/video/projects/${projectId}/messages`,async r=>{await pending;await r.fulfill({status:503,json:{error:{message:'模型暂时不可用'}}})});
 await page.goto('/video');const input=page.getByRole('textbox');await input.fill('第一条想法');await page.getByRole('button',{name:'发送'}).click();
 await input.fill('下一段不能丢');release();await expect(input).toHaveValue('下一段不能丢');await expect(page.getByRole('status')).toContainText('模型暂时不可用');
});
test('a draft survives reload and mobile tab switches',async({page})=>{
 await page.setViewportSize({width:390,height:844});await page.goto('/video');const input=page.getByRole('textbox');await input.fill('这段草稿不能丢');
 await page.getByRole('button',{name:'看视频'}).click();await page.getByRole('button',{name:'聊想法'}).click();await expect(input).toHaveValue('这段草稿不能丢');
 await page.reload();await expect(page.getByRole('textbox')).toHaveValue('这段草稿不能丢');
});
test('AT-074/027 style modal restores focus and keeps the creative draft',async({page})=>{
 await page.goto('/video');await page.getByRole('textbox').fill('保留我的想法');const trigger=page.getByRole('button',{name:'看看全部画风'});await trigger.click();
 await expect(page.getByRole('dialog')).toBeVisible();await page.getByRole('textbox',{name:'搜索画风'}).fill('水墨');await expect(page.getByRole('button',{name:/中国水墨/})).toBeVisible();
 await page.keyboard.press('Escape');await expect(page.getByRole('dialog')).not.toBeVisible();await expect(trigger).toBeFocused();await expect(page.getByRole('textbox')).toHaveValue('保留我的想法');
});
test('recent projects list uses only server-authorized project summaries',async({page})=>{
 await page.addInitScript(id=>localStorage.setItem('vb-recent-project-ids',JSON.stringify([id])),projectId);
 await page.route('**/api/video/projects/lookup',r=>r.fulfill({json:{projects:[{projectId,title:'我的真实项目',phase:'collecting',expiresAt:'2030-01-01T00:00:00Z'}]}}));
 await page.goto('/video');const trigger=page.getByRole('button',{name:'我的视频'});await trigger.click();
 await expect(page.getByRole('dialog',{name:'我的视频'})).toBeVisible();await expect(page.getByRole('link',{name:'我的真实项目'})).toHaveAttribute('href',`/video/${projectId}`);
 await page.keyboard.press('Escape');await expect(trigger).toBeFocused();
});
test('Markdown material is uploaded, confirmed, and sent without text after reload',async({page})=>{
 const assetId='20000000-0000-4000-8000-000000000002',reservationId='30000000-0000-4000-8000-000000000003';
 let uploaded='';let sent:{text:string;attachmentIds:string[]}|undefined;
 await page.route('**/api/video/session',r=>r.fulfill({json:{expiresAt:'2030-01-01'}}));
 await page.route('**/api/video/projects',r=>r.fulfill({json:{projectId,controlVersion:1}}));
 await page.route(`**/api/video/projects/${projectId}`,r=>r.fulfill({json:{...view,assets:uploaded?[{id:assetId,filename:'brief.md',status:'ready',intendedUse:'reference'}]:[]}}));
 await page.route(`**/api/video/projects/${projectId}/assets/reserve`,async r=>{
  const body=r.request().postDataJSON();expect(body.rightsConfirmed).toBe(true);expect(body.declaredMime).toBe('text/markdown');
  await r.fulfill({json:{assetId,reservationId,uploadUrl:`/api/video/projects/${projectId}/assets/${assetId}/file`}});
 });
 await page.route(`**/api/video/projects/${projectId}/assets/${assetId}/file`,async r=>{uploaded=r.request().postData()||'';await r.fulfill({json:{assetId,status:'uploaded_bytes'}})});
 await page.route(`**/api/video/projects/${projectId}/assets/${assetId}/complete`,r=>r.fulfill({status:202,json:{assetId,status:'ready'}}));
 await page.route(`**/api/video/projects/${projectId}/messages`,async r=>{sent=r.request().postDataJSON();await r.fulfill({status:202,json:{operationId:'40000000-0000-4000-8000-000000000004'}})});
 await page.goto('/video');
 await page.getByRole('button',{name:/添加资料/}).click();
 await page.getByLabel('选择 Markdown 资料').setInputFiles({name:'brief.md',mimeType:'text/markdown',buffer:Buffer.from('# 真实资料\n价格是 30 元')});
 await expect(page.getByRole('button',{name:'确认并添加'})).toBeDisabled();
 await page.getByRole('checkbox',{name:'我有权使用这份资料'}).check();
 await page.getByRole('button',{name:'确认并添加'}).click();
 await expect(page.getByText('brief.md · 已读取，待发送')).toBeVisible();
 expect(uploaded).toContain('价格是 30 元');
 await page.reload();
 await expect(page.getByText('brief.md · 已读取，待发送')).toBeVisible();
 await page.getByRole('button',{name:'发送'}).click();
 await expect.poll(()=>sent).toMatchObject({text:'',attachmentIds:[assetId]});
 await expect(page.getByText('brief.md · 已读取，待发送')).not.toBeVisible();
});
test('a failed material reservation keeps the chosen file for retry',async({page})=>{
 let attempts=0;
 await page.route('**/api/video/session',r=>r.fulfill({json:{expiresAt:'2030-01-01'}}));
 await page.route('**/api/video/projects',r=>r.fulfill({json:{projectId,controlVersion:1}}));
 await page.route(`**/api/video/projects/${projectId}/assets/reserve`,r=>{attempts++;return r.fulfill({status:503,json:{error:{message:'暂时无法预约资料'}}})});
 await page.goto('/video');
 await page.getByRole('button',{name:/添加资料/}).click();
 await page.getByLabel('选择 Markdown 资料').setInputFiles({name:'notes.md',mimeType:'text/markdown',buffer:Buffer.from('# 内容')});
 await page.getByRole('checkbox',{name:'我有权使用这份资料'}).check();
 await page.getByRole('button',{name:'确认并添加'}).click();
 await expect(page.getByRole('status')).toContainText('暂时无法预约资料');
 await expect(page.getByText('notes.md')).toBeVisible();
 await page.getByRole('button',{name:'确认并添加'}).click();
 await expect.poll(()=>attempts).toBe(2);
});
