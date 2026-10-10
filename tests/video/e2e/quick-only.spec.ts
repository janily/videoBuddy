import {test,expect} from '@playwright/test';
const pid='10000000-0000-4000-8000-000000000001',aid='20000000-0000-4000-8000-000000000002';
const view={projectId:pid,title:'保留的视频',controlVersion:2,briefVersion:2,phase:'ready',understanding:{subject:'中秋祝福',audience:'家人',summary:[]},preferences:{durationSec:30,aspect:'9:16',language:'zh-CN',styleSlug:'paper-lantern'},quick:{music:{mode:'auto'},tracks:[]},assets:[],messages:[{id:crypto.randomUUID(),role:'user',text:'中秋祝福',ordinal:1,status:'completed',contentVersion:1}],currentResult:{resultId:crypto.randomUUID(),artifactId:aid,revisionId:crypto.randomUUID(),bundleHash:'a'.repeat(64),createdAt:new Date().toISOString(),kind:'quick',quick:{styleSlug:'paper-lantern',aspect:'9:16',durationSec:30,shots:[],music:null}},previousResult:null,activeConversation:null,activeProduction:null,pendingInputs:[],actions:[{kind:'generate_video',enabled:true}],expiresAt:'2030-01-01T00:00:00Z'};
test('quick videos offer MP4 and private poster only',async({page})=>{
 await page.route(`**/api/video/projects/${pid}`,r=>r.fulfill({json:view}));await page.route('**/access?purpose=play',r=>r.fulfill({json:{url:'/no-live-video.mp4'}}));await page.route('**/no-live-video.mp4',r=>r.fulfill({status:404}));
 await page.goto(`/video/${pid}`);await expect(page.getByRole('button',{name:'下载视频',exact:true})).toBeVisible();await page.getByText('更多',{exact:true}).click();await expect(page.getByRole('button',{name:'下载封面',exact:true})).toBeEnabled();
 for(const name of ['下载字幕','下载文案','下载来源与许可记录','下载质量报告','下载工程包','就按这个做 →','先看效果 →'])await expect(page.getByRole('button',{name,exact:true})).toHaveCount(0);
});
test('migrated projects explain the reset and never resume a stored retired approval',async({page})=>{
 const notice='旧版效果确认流程已结束，想法已保留，可以直接重新生成视频。';let approvals=0;
 await page.addInitScript(({pid})=>localStorage.setItem(`vb-approve:${pid}`,JSON.stringify({version:1,projectId:pid,request:{schemaVersion:5,clientCommandId:crypto.randomUUID(),previewId:crypto.randomUUID(),revisionId:crypto.randomUUID(),expectedBriefVersion:2,bundleHash:'a'.repeat(64),scriptHash:'b'.repeat(64),factsHash:'c'.repeat(64)}})),{pid});
 await page.route('**/preview/approve',r=>{approvals++;return r.fulfill({json:{projectId:pid,controlVersion:2}})});
 await page.route(`**/api/video/projects/${pid}`,r=>r.fulfill({json:{...view,phase:'collecting',currentResult:null,legacyMigrationNotice:notice}}));
 await page.goto(`/video/${pid}`);await expect(page.getByText(notice,{exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'生成视频 →',exact:true})).toBeEnabled();await page.reload();await expect(page.getByText(notice,{exact:true})).toBeVisible();expect(approvals).toBe(0);
});
test('retired persisted exports are not dispatched after reload',async({page})=>{
 let exports=0;await page.addInitScript(({pid,aid})=>localStorage.setItem(`vb-export:${pid}:${aid}`,JSON.stringify({version:1,request:{schemaVersion:5,clientCommandId:crypto.randomUUID(),artifactId:aid,format:'source_zip'}})),{pid,aid});
 await page.route(`**/api/video/projects/${pid}`,r=>r.fulfill({json:view}));await page.route('**/access?purpose=play',r=>r.fulfill({json:{url:'/no-live-video.mp4'}}));await page.route('**/no-live-video.mp4',r=>r.fulfill({status:404}));await page.route('**/exports',r=>{exports++;return r.fulfill({status:410,json:{}})});
 await page.goto(`/video/${pid}`);await expect(page.getByRole('button',{name:'下载视频',exact:true})).toBeVisible();await page.reload();await expect(page.getByRole('button',{name:'下载视频',exact:true})).toBeVisible();expect(exports).toBe(0);
});
test('a private download grant cannot redirect the browser to a foreign origin',async({page})=>{
 let foreignRequests=0,downloads=0;page.on('download',()=>downloads++);await page.route(`**/api/video/projects/${pid}`,r=>r.fulfill({json:view}));await page.route('**/access?purpose=play',r=>r.fulfill({json:{url:'/no-live-video.mp4'}}));await page.route('**/no-live-video.mp4',r=>r.fulfill({status:404}));
 await page.route('https://foreign.invalid/**',r=>{foreignRequests++;return r.abort()});await page.route('**/exports',r=>r.fulfill({json:{status:200,artifactId:aid,access:{url:`https://foreign.invalid/api/video/projects/${pid}/artifacts/${aid}/file?purpose=download&token=private`,purpose:'download',filename:'video.mp4',mime:'video/mp4',expiresAt:'2030-01-01T00:00:00Z'}}}));
 await page.goto(`/video/${pid}`);await page.getByRole('button',{name:'下载视频',exact:true}).click();await expect(page.getByRole('alert').filter({hasText:'下载连接暂时不可用'})).toBeVisible();expect(foreignRequests).toBe(0);expect(downloads).toBe(0);
});
test.afterEach(async({page})=>{await expect(page.locator('dialog[open]')).toHaveCount(0)});
