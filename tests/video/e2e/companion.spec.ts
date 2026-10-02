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
