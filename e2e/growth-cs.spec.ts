import {test,expect} from '@playwright/test';
// Real local D1/API/Chromium. Only one response loss is injected; no customer reply or refund is sent.
test('고객 문의 접수·원문 차단·기한 초과·처리 기록',async({browser},info)=>{
 const owner=`cs-${info.project.name}-${Date.now()}`,context=await browser.newContext({baseURL:info.project.use.baseURL,viewport:info.project.use.viewport,extraHTTPHeaders:{'oai-authenticated-user-id':owner}}),page=await context.newPage();
 try{
  const post=async(path:string,data:unknown)=>{const r=await page.request.post(path,{data});expect(r.status(),await r.text()).toBe(200);return r.json()};await page.request.get('/api/workspace');
  const {id:storeId}=await post('/api/stores',{action:'save_store',brandId:'ofd',data:{name:'문의 합성 지점',address:'합성 주소',tradeArea:'residential',goal:'문의'}});
  const title=`고객 문의 ${info.project.name}`;await post('/api/action',{action:'save_campaign',data:{brandId:'ofd',storeId,title,goal:'문의'}});
  await page.goto('/');if((page.viewportSize()?.width??1280)<768)await page.locator('[data-sidebar="trigger"]').first().click();await page.getByRole('button',{name:'캠페인',exact:true}).click();if((page.viewportSize()?.width??1280)<768)await page.keyboard.press('Escape');await page.getByRole('button',{name:title+' 열기',exact:true}).click();await page.getByRole('tab',{name:'성장·판매',exact:true}).click();
  await page.locator('summary').filter({hasText:/^고객 문의·약속 기한$/}).click();const panel=page.getByRole('region',{name:'고객 문의 처리',exact:true});await expect(panel).toBeVisible({timeout:5000});
  const local=(t:number)=>new Date(t-new Date().getTimezoneOffset()*60000).toISOString().slice(0,16),now=Date.now();
  const summary=panel.getByRole('textbox',{name:'운영자 요약(고객 원문·연락처 제외)',exact:true});
  await summary.fill('고객 010-1234-5678 연락 요청');await panel.getByRole('textbox',{name:'담당',exact:true}).fill('CS 담당');await panel.getByLabel('접수 시각',{exact:true}).fill(local(now-5*3600000));await panel.getByLabel('약속 기한',{exact:true}).fill(local(now-3600000));
  await panel.getByRole('button',{name:'문의 접수',exact:true}).click();await expect(panel.getByRole('alert')).toContainText('운영자 요약만');await expect(summary).toHaveValue('고객 010-1234-5678 연락 요청');
  await summary.fill('배송 지연 문의, 출고 일정 안내 필요');
  const attempts:string[]=[];let lose=true;await page.route('**/api/growth/cs',async route=>{if(route.request().method()==='POST'){attempts.push(route.request().postDataJSON().requestId);if(lose){lose=false;await route.fetch();await route.abort('failed');return;}}await route.continue();});
  await panel.getByRole('button',{name:'문의 접수',exact:true}).click();await expect(panel.getByRole('alert')).toContainText('입력은 보존했습니다');
  await panel.getByRole('button',{name:'문의 접수',exact:true}).click();await expect(panel.getByRole('status').filter({hasText:'문의를 접수했습니다'})).toBeVisible();expect(attempts[0]).toBe(attempts[1]);
  await expect(panel).toContainText('미해결 1건, 기한 초과 1건');await expect(panel).toContainText('기한 초과');
  const id=((await panel.locator('li p').first().textContent())??'').split(', ')[1].trim();
  await panel.getByRole('button',{name:`${id} 처리 기록`,exact:true}).click();await panel.getByRole('combobox',{name:'처리 종류',exact:true}).selectOption('resolve');await panel.getByRole('combobox',{name:'해결 방법',exact:true}).selectOption('shipped');await panel.getByRole('textbox',{name:'처리 증빙 ID',exact:true}).fill('ship-1');
  await panel.getByRole('button',{name:'처리 저장',exact:true}).click();await expect(panel.getByRole('status').filter({hasText:'처리를 기록했습니다'})).toBeVisible();await expect(panel).toContainText('미해결 0건, 기한 초과 0건');await expect(panel).toContainText('기한 뒤 해결');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1)).toBe(true);
 }finally{await context.close()}
});
