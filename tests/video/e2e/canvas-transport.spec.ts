import {test,expect} from '@playwright/test';
const projectId='10000000-0000-4000-8000-000000000091';
const assistantId='10000000-0000-4000-8000-000000000092';
const view={projectId,title:'中秋祝福',controlVersion:1,briefVersion:1,phase:'collecting',understanding:{subject:'中秋祝福',summary:['给家人的温暖祝福'],audience:'家人',objective:'节日祝福',facts:[]},preferences:{durationSec:30,aspect:'9:16',language:'zh-CN',styleSlug:null},assets:[],messages:[{id:assistantId,ordinal:2,role:'assistant',text:'想要什么感觉？',status:'completed',contentVersion:1,ui:{quickReplies:[{label:'温暖团圆',text:'希望温暖团圆'}]}}],currentResult:null,previousResult:null,activeConversation:null,activeProduction:null,pendingInputs:[],actions:[],expiresAt:'2030-01-01T00:00:00Z',quick:{music:{mode:'auto'},tracks:[]}};
test('quick reply sends its text without consuming the independent composer draft',async({page})=>{
 await page.route('**/api/video/session',r=>r.fulfill({json:{}}));
 await page.route(`**/api/video/projects/${projectId}`,r=>r.fulfill({json:view}));
 let body:Record<string,unknown>|undefined;
 await page.route(`**/api/video/projects/${projectId}/messages`,async r=>{body=r.request().postDataJSON();await r.fulfill({status:202,json:{}})});
 await page.goto(`/video/${projectId}`);
 await page.locator('.composer textarea').fill('这段草稿还没写完');
 await page.getByRole('button',{name:'温暖团圆',exact:true}).click();
 await expect.poll(()=>body?.text).toBe('希望温暖团圆');
 expect(body?.attachmentIds).toEqual([]);
 await expect(page.locator('.composer textarea')).toHaveValue('这段草稿还没写完');
 await expect(page.locator('dialog[open]')).toHaveCount(0);
});
test('failed quick reply can be retried with the same identity and preserves newly typed text',async({page})=>{
 await page.route('**/api/video/session',r=>r.fulfill({json:{}}));
 await page.route(`**/api/video/projects/${projectId}`,r=>r.fulfill({json:view}));
 const requests:Record<string,unknown>[]=[];
 await page.route(`**/api/video/projects/${projectId}/messages`,async r=>{requests.push(r.request().postDataJSON());await r.fulfill({status:503,json:{error:{message:'暂时无法连接'}}})});
 await page.goto(`/video/${projectId}`);
 await page.locator('.composer textarea').fill('不应随快捷回复发送');
 await page.getByRole('button',{name:'温暖团圆',exact:true}).click();
 await expect.poll(()=>requests.length).toBe(1);
 await page.locator('.composer textarea').fill('重试期间的新草稿');
 await page.getByRole('button',{name:/重发上一条/}).click();
 await expect.poll(()=>requests.length).toBe(2);
 expect(requests[1]).toEqual(requests[0]);
 await expect(page.locator('.composer textarea')).toHaveValue('重试期间的新草稿');
});
test('script completion refreshes the canvas and records observed duration without logging message text',async({page})=>{
 const operationId='10000000-0000-4000-8000-000000000093';let ready=false,reads=0;
 const events:Record<string,unknown>[]=[];
 await page.route('**/api/video/analytics',async r=>{events.push(r.request().postDataJSON());await r.fulfill({json:{}})});
 await page.route(`**/api/video/projects/${projectId}`,r=>{reads++;return r.fulfill({json:{...view,activeScript:ready?null:{id:operationId,kind:'script',status:'running',streamEpoch:0},script:{briefVersion:1,summary:'月亮升起，一家团圆',selectionReason:'先景后人',shots:[],state:ready?'ready':'drafting'}}})});
 await page.route(`**/api/video/projects/${projectId}/operations/${operationId}/events`,r=>{
  ready=true;
  const event=(type:string,payload:object,index:number)=>`id: 0:${index}\ndata: ${JSON.stringify({schemaVersion:5,projectId,operationId,epoch:0,eventId:crypto.randomUUID(),createdAt:new Date().toISOString(),type,payload})}\n\n`;
  return r.fulfill({contentType:'text/event-stream',body:event('script.ready',{briefVersion:1},0)+event('operation.terminal',{status:'succeeded',retryable:false},1)});
 });
 await page.goto(`/video/${projectId}`);
 await expect.poll(()=>reads).toBeGreaterThan(1);
 await expect.poll(()=>events.some(v=>(v.event as {name:string})?.name==='script_ready')).toBe(true);
 expect(JSON.stringify(events)).not.toContain('月亮升起');
});
