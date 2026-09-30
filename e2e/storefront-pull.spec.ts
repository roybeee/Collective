import {test,expect} from '@playwright/test';
// Real local D1/API/Chromium. The connection is created and toggled but never pulled, so no external request leaves the machine.
test('판매처 주문 조회 연결 생성·토큰 비노출·켜기/끄기',async({browser},info)=>{
 const owner=`pull-${info.project.name}-${Date.now()}`,context=await browser.newContext({baseURL:info.project.use.baseURL,viewport:info.project.use.viewport,extraHTTPHeaders:{'oai-authenticated-user-id':owner}}),page=await context.newPage();
 try{
  const post=async(path:string,data:unknown)=>{const r=await page.request.post(path,{data});expect(r.status(),await r.text()).toBe(200);return r.json()};await page.request.get('/api/workspace');
  const {id:storeId}=await post('/api/stores',{action:'save_store',brandId:'ofd',data:{name:'조회 합성 지점',address:'합성 주소',tradeArea:'residential',goal:'조회'}});
  const title=`주문 조회 ${info.project.name}`;await post('/api/action',{action:'save_campaign',data:{brandId:'ofd',storeId,title,goal:'조회'}});
  let external=0;await page.route('https://shop.example.com/**',route=>{external++;return route.abort()});
  await page.goto('/');if((page.viewportSize()?.width??1280)<768)await page.locator('[data-sidebar="trigger"]').first().click();await page.getByRole('button',{name:'캠페인',exact:true}).click();if((page.viewportSize()?.width??1280)<768)await page.keyboard.press('Escape');await page.getByRole('button',{name:title+' 열기',exact:true}).click();await page.getByRole('tab',{name:'성장·판매',exact:true}).click();
  await page.locator('summary').filter({hasText:/^판매처 주문 조회 연결$/}).click();const panel=page.getByRole('region',{name:'판매처 주문 조회',exact:true});await expect(panel).toBeVisible({timeout:5000});
  await panel.getByRole('textbox',{name:'판매처 키',exact:true}).fill('mapdal');await panel.getByRole('textbox',{name:'주문 조회 URL(HTTPS)',exact:true}).fill('http://shop.example.com/orders');await panel.getByLabel('조회 토큰',{exact:true}).fill('tok_'+'b'.repeat(28));
  await panel.getByRole('button',{name:'연결 만들기',exact:true}).click();await expect(panel.getByRole('alert')).toContainText('HTTPS');
  await panel.getByRole('textbox',{name:'주문 조회 URL(HTTPS)',exact:true}).fill('https://shop.example.com/orders');await panel.getByLabel('조회 토큰',{exact:true}).fill('tok_'+'b'.repeat(28));await panel.getByRole('button',{name:'연결 만들기',exact:true}).click();
  await expect(panel.getByRole('status').filter({hasText:'연결을 만들었습니다'})).toBeVisible();await expect(panel).toContainText('mapdal · https://shop.example.com/orders · 꺼짐');await expect(panel).not.toContainText('b'.repeat(28));
  await panel.getByRole('button',{name:'mapdal 켜기',exact:true}).click();await expect(panel).toContainText('· 켜짐 ·');await panel.getByRole('button',{name:'mapdal 끄기',exact:true}).click();await expect(panel).toContainText('· 꺼짐 ·');
  const api=await (await page.request.get('/api/storefront-pulls')).text();expect(api).not.toContain('b'.repeat(28));expect(external).toBe(0);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1)).toBe(true);
 }finally{await context.close()}
});
