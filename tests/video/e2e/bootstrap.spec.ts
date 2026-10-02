import { test, expect } from '@playwright/test';
test('BT-07 React companion keeps a single draft and reports unavailable services honestly', async ({page}) => {
 await page.goto('/video');
 await expect(page.getByRole('heading', {name:'先聊聊，你想做什么视频？'})).toBeVisible();
 const input=page.getByRole('textbox'); await expect(input).toHaveCount(1);
 await input.fill('给我的咖啡店做介绍'); await page.getByRole('button', {name:'发送'}).click();
 await expect(page.getByRole('status')).toContainText('尚未配置');
 await expect(input).toHaveValue('给我的咖啡店做介绍');
 await expect(page.locator('video')).toHaveCount(0);
});
test('examples fill only the draft; IME Enter never submits', async ({page}) => {
 await page.goto('/video'); await page.getByRole('button', {name:'给我的咖啡店做一支介绍视频'}).click();
 const input=page.getByRole('textbox'); await expect(input).toHaveValue('给我的咖啡店做一支介绍视频');
 await input.dispatchEvent('compositionstart'); await input.press('Enter');
 await expect(page.getByRole('status',{includeHidden:true})).toBeEmpty();
 await input.dispatchEvent('compositionend');
});
for (const width of [360,390,768,960,1024,1280,1440,1920]) test(`companion width ${width} has one input and no horizontal overflow`,async({page})=>{
 await page.setViewportSize({width,height:900}); await page.goto('/video');
 await expect(page.getByRole('textbox')).toHaveCount(1);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 if(width<960) await expect(page.getByRole('button',{name:'聊想法'})).toBeVisible();
 else await expect(page.getByRole('heading',{name:'创作助手'})).toBeVisible();
 await page.screenshot({path:`docs/engineering/screens/bootstrap-${width}.png`,fullPage:true});
});
