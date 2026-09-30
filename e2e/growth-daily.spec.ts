import {test,expect} from '@playwright/test';
// Real local D1/API/Chromium. Manual run of the daily loop; no model, publication, spend or send.
test('일일 운영 루프 수동 실행·하루 1회·오늘 안건',async({browser},info)=>{
 const owner=`daily-${info.project.name}-${Date.now()}`,context=await browser.newContext({baseURL:info.project.use.baseURL,viewport:info.project.use.viewport,extraHTTPHeaders:{'oai-authenticated-user-id':owner}}),page=await context.newPage();
 try{
  const post=async(path:string,data:unknown)=>{const r=await page.request.post(path,{data});expect(r.status(),await r.text()).toBe(200);return r.json()};await page.request.get('/api/workspace');
  const {id:storeId}=await post('/api/stores',{action:'save_store',brandId:'ofd',data:{name:'일일 합성 지점',address:'합성 주소',tradeArea:'residential',goal:'일일'}});
  const title=`일일 루프 ${info.project.name}`,{id:campaignId}=await post('/api/action',{action:'save_campaign',data:{brandId:'ofd',storeId,title,goal:'일일'}});
  const day=(n:number)=>new Date(Date.now()-n*86400000).toISOString().slice(0,10);
  for(let i=0;i<14;i++)await post('/api/store-operations',{action:'save_order',storeId,data:{source:'direct',orderNumber:'D'+i,orderDate:day(i%7),mode:'delivery',status:'paid',paidAmount:1000,refundAmount:0,channel:'unknown',campaignId,attributionEvidence:'운영자 확인'}});
  for(let i=0;i<21;i++)await post('/api/store-operations',{action:'save_order',storeId,data:{source:'direct',orderNumber:'E'+i,orderDate:day(7+i),mode:'delivery',status:'paid',paidAmount:1000,refundAmount:0,channel:'unknown',campaignId,attributionEvidence:'운영자 확인'}});
  await page.goto('/');if((page.viewportSize()?.width??1280)<768)await page.locator('[data-sidebar="trigger"]').first().click();await page.getByRole('button',{name:'캠페인',exact:true}).click();if((page.viewportSize()?.width??1280)<768)await page.keyboard.press('Escape');await page.getByRole('button',{name:title+' 열기',exact:true}).click();await page.getByRole('tab',{name:'성장·판매',exact:true}).click();
  await page.locator('summary').filter({hasText:/^일일 운영 루프·오늘의 안건$/}).click();const panel=page.getByRole('region',{name:'일일 운영 루프',exact:true});await expect(panel).toBeVisible({timeout:5000});
  await expect(panel).toContainText('현재 꺼짐');await expect(panel).toContainText('실행 기록이 없습니다');
  await panel.getByRole('button',{name:'오늘 안건 지금 만들기',exact:true}).click();await expect(panel.getByRole('status').filter({hasText:'오늘 안건을 만들었습니다'})).toBeVisible();
  await expect(panel).toContainText('새 감지 신호에 담당·기한을 지정하거나 기각하세요.');
  await panel.getByRole('button',{name:'오늘 안건 지금 만들기',exact:true}).click();await expect(panel.getByRole('status').filter({hasText:'이미 실행했습니다'})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1)).toBe(true);
 }finally{await context.close()}
});
