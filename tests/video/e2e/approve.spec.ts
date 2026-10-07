import {test,expect,type Page} from '@playwright/test';
const pid='10000000-0000-4000-8000-000000000001',previewId='20000000-0000-4000-8000-000000000002',revisionId='30000000-0000-4000-8000-000000000003';
const initial={projectId:pid,title:'MVP批准协议测试',controlVersion:1,briefVersion:2,phase:'preview_ready',understanding:{summary:[],subject:'协议测试'},preferences:{durationSec:20,aspect:'16:9',language:'zh-CN',styleSlug:'crayon-book',voiceMode:'tts',musicMode:'none',captions:'auto'},assets:[],messages:[],currentPreview:{previewId,revisionId,briefVersion:2,previewArtifactId:'40000000-0000-4000-8000-000000000004',bundleHash:'a'.repeat(64),scriptHash:'b'.repeat(64),factsHash:'c'.repeat(64),script:['字幕测试'],criticalFacts:[],summary:'协议测试',expiresAt:'2030-01-01T00:00:00Z',state:'ready'},currentResult:null,previousResult:null,activeConversation:null,activeProduction:null,pendingInputs:[],actions:[{kind:'approve_preview',enabled:true},{kind:'prepare_preview',enabled:true}],expiresAt:'2030-01-01T00:00:00Z'};
async function setup(page:Page){await page.route(`**/api/video/projects/${pid}`,r=>r.fulfill({json:initial}));await page.route('**/access?purpose=play',r=>r.fulfill({json:{url:'/protocol-only-no-video.mp4'}}));await page.route('**/protocol-only-no-video.mp4',r=>r.fulfill({status:404}))}
test('click freezes displayed preview identity, keeps draft and does not double-submit',async({page})=>{
 await setup(page);const requests:Record<string,unknown>[]=[];let release:()=>void=()=>{};const wait=new Promise<void>(resolve=>{release=resolve});
 await page.route('**/preview/approve',async r=>{requests.push(r.request().postDataJSON());await wait;await r.fulfill({json:{projectId:pid,controlVersion:1,status:'accepted'}})});
 await page.goto(`/video/${pid}`);await page.getByRole('textbox').fill('保留草稿');const button=page.getByRole('button',{name:'就按这个做 →'});await expect(button).toBeEnabled();await button.click();await expect(page.getByRole('button',{name:'正在确认…'})).toBeDisabled();release();
 await expect(page.getByText('制作请求已确认。',{exact:true})).toBeVisible();expect(requests).toHaveLength(1);expect(requests[0]).toMatchObject({schemaVersion:5,previewId,revisionId,expectedBriefVersion:2,bundleHash:'a'.repeat(64),scriptHash:'b'.repeat(64),factsHash:'c'.repeat(64)});await expect(page.getByRole('textbox')).toHaveValue('保留草稿');
});
test('reload after lost acknowledgement replays only the persisted explicit approval',async({page})=>{
 await setup(page);const ids:string[]=[];await page.route('**/preview/approve',r=>{ids.push(r.request().postDataJSON().clientCommandId);return ids.length===1?r.abort('failed'):r.fulfill({json:{projectId:pid,controlVersion:1,status:'replayed'}})});
 await page.goto(`/video/${pid}`);await page.getByRole('button',{name:'就按这个做 →'}).click();await expect(page.getByRole('button',{name:'重新连接制作'})).toBeVisible();await page.reload();await expect(page.getByText('制作请求已确认。',{exact:true})).toBeVisible();expect(ids).toHaveLength(2);expect(new Set(ids).size).toBe(1);
 expect(await page.evaluate(()=>localStorage.getItem(`vb-approve:${location.pathname.split('/').pop()}`))).toBeNull();
});
test('an older tab cannot overwrite a newer persisted approval while reconnecting',async({page,context})=>{
 await setup(page);await page.route('**/preview/approve',r=>r.abort('failed'));await page.goto(`/video/${pid}`);await page.getByRole('button',{name:'就按这个做 →'}).click();await expect(page.getByRole('button',{name:'重新连接制作'})).toBeVisible();
 const newer={version:1,projectId:pid,request:{schemaVersion:5,clientCommandId:crypto.randomUUID(),previewId:crypto.randomUUID(),revisionId,expectedBriefVersion:3,bundleHash:'d'.repeat(64),scriptHash:'e'.repeat(64),factsHash:'f'.repeat(64)}};
 const peer=await context.newPage();await peer.goto('/video');await peer.evaluate(({pid,newer})=>localStorage.setItem(`vb-approve:${pid}`,JSON.stringify(newer)),{pid,newer});
 await page.getByRole('button',{name:'重新连接制作'}).click();await expect.poll(()=>page.evaluate(pid=>JSON.parse(localStorage.getItem(`vb-approve:${pid}`)||'{}').request?.clientCommandId,pid)).toBe(newer.request.clientCommandId);await peer.close();
});
test('selecting the existing movie under a new ready preview sends feedback for that movie',async({page})=>{
 await setup(page);const oldId='60000000-0000-4000-8000-000000000006',oldRevision='70000000-0000-4000-8000-000000000007';
 await page.route(`**/api/video/projects/${pid}`,r=>r.fulfill({json:{...initial,currentResult:{resultId:crypto.randomUUID(),artifactId:oldId,revisionId:oldRevision,bundleHash:'d'.repeat(64),createdAt:new Date().toISOString()}}}));
 await page.route('**/api/video/session',r=>r.fulfill({json:{status:'created'}}));let selected='';await page.route(`**/api/video/projects/${pid}/messages`,r=>{selected=r.request().postDataJSON().target?.artifactId;return r.fulfill({json:{status:'accepted'}})});
 await page.goto(`/video/${pid}`);await page.getByLabel('效果预览',{exact:true}).click();await page.getByText('查看已有视频',{exact:true}).click();await page.getByLabel('已有完整视频',{exact:true}).click();await page.getByRole('textbox').fill('把这支已有影片的标题改短');await page.getByRole('button',{name:'发送',exact:true}).click();await expect.poll(()=>selected).toBe(oldId);
});

test('acknowledged approval does not lock a new preview after formal production fails',async({page})=>{
 await setup(page);let approved=false,approvals=0;
 const failed={...initial,controlVersion:2,phase:'attention',currentPreview:{...initial.currentPreview,state:'superseded'},actions:[{kind:'approve_preview',enabled:false},{kind:'prepare_preview',enabled:true}],productionFailure:{operationId:crypto.randomUUID(),errorCode:'RENDER_FAILED',message:'本次完整视频制作未完成，效果片段和已有结果已保留。'}};
 await page.route(`**/api/video/projects/${pid}`,r=>r.fulfill({json:approved?failed:initial}));
 await page.route('**/preview/approve',r=>{approved=true;approvals++;return r.fulfill({json:{projectId:pid,controlVersion:2,status:'accepted'}})});
 await page.goto(`/video/${pid}`);await page.getByRole('button',{name:'就按这个做 →'}).click();
 await expect(page.getByText('制作请求已确认。',{exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'就按这个做 →'})).toBeDisabled();
 await expect(page.getByRole('button',{name:'先看新效果',exact:true})).toBeEnabled({timeout:2000});expect(approvals).toBe(1);
});

test('a changed brief can request a new preview while the published movie stays available',async({page})=>{
 await setup(page);const oldId='60000000-0000-4000-8000-000000000006';
 await page.route(`**/api/video/projects/${pid}`,r=>r.fulfill({json:{...initial,phase:'ready',briefVersion:3,currentPreview:{...initial.currentPreview,state:'stale'},currentResult:{resultId:crypto.randomUUID(),artifactId:oldId,revisionId,bundleHash:'d'.repeat(64),createdAt:new Date().toISOString()},actions:[{kind:'prepare_preview',enabled:true},{kind:'approve_preview',enabled:false}]}}));
 const requests:Record<string,unknown>[]=[];await page.route(`**/api/video/projects/${pid}/preview`,r=>{requests.push(r.request().postDataJSON());return r.fulfill({json:{status:'accepted'}})});
 await page.goto(`/video/${pid}`);await expect(page.getByLabel('完整视频',{exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'下载视频',exact:true})).toBeEnabled();await page.getByRole('textbox').fill('尚未发送的草稿');
 await page.getByRole('button',{name:'先看新效果',exact:true}).click();await expect.poll(()=>requests.length).toBe(1);expect(requests[0]).toMatchObject({expectedBriefVersion:3});await expect(page.getByRole('textbox')).toHaveValue('尚未发送的草稿');await expect(page.getByLabel('完整视频',{exact:true})).toBeVisible();
});
