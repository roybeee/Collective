import {test,expect} from '@playwright/test';
// Real local D1/API/Chromium. Only one response loss is injected.
test('여러 상품 번들 원가·최대 번들 수·계획 초과 표시·응답 유실 재시도',async({browser},info)=>{
 const owner=`bundle-${info.project.name}-${Date.now()}`,context=await browser.newContext({baseURL:info.project.use.baseURL,viewport:info.project.use.viewport,extraHTTPHeaders:{'oai-authenticated-user-id':owner}}),page=await context.newPage();
 try{
  const post=async(path:string,data:unknown)=>{const r=await page.request.post(path,{data});expect(r.status(),await r.text()).toBe(200);return r.json()};await page.request.get('/api/workspace');
  const {id:storeId}=await post('/api/stores',{action:'save_store',brandId:'ofd',data:{name:'번들 합성 지점',address:'합성 주소',tradeArea:'residential',goal:'번들'}});
  const title=`번들 ${info.project.name}`,{id:campaignId}=await post('/api/action',{action:'save_campaign',data:{brandId:'ofd',storeId,title,goal:'번들'}});
  const cat=(id:string,sku:string,price:number,unitCost:number)=>post('/api/growth',{action:'save_catalog',id,input:{sku,title:sku+' 상품',price,unitCost,variableCost:0,stock:0,stockUnit:'piece',currency:'KRW',taxBasis:'included',fulfillment:'배송',refunds:'반품',rightsConfirmed:true,factIds:[],validUntil:'2099-01-01'},campaignId,campaignVersion:1,expectedVersion:0});
  await cat('main','MAIN',6000,2000);await cat('side','SIDE',2000,500);
  const stock=(sku:string,onHand:number)=>post('/api/growth/operations',{action:'create_inventory',campaignId,campaignVersion:1,input:{sku,locationId:storeId,unit:'piece',onHand},observedAt:new Date(Date.now()-60000).toISOString(),evidenceRef:'count-'+sku});
  await stock('MAIN',10);await stock('SIDE',5);
  await page.goto('/');if((page.viewportSize()?.width??1280)<768)await page.locator('[data-sidebar="trigger"]').first().click();await page.getByRole('button',{name:'캠페인',exact:true}).click();if((page.viewportSize()?.width??1280)<768)await page.keyboard.press('Escape');await page.getByRole('button',{name:title+' 열기',exact:true}).click();await page.getByRole('tab',{name:'성장·판매',exact:true}).click();
  await page.locator('summary').filter({hasText:/^여러 상품 번들$/}).click();const panel=page.getByRole('region',{name:'번들 오퍼',exact:true});await expect(panel).toBeVisible({timeout:5000});
  await panel.getByRole('button',{name:'새 번들',exact:true}).click();await panel.getByRole('textbox',{name:'번들명',exact:true}).fill('점심 세트');
  await panel.getByRole('combobox',{name:'구성 상품 1',exact:true}).selectOption('main');await panel.getByRole('combobox',{name:'구성 상품 2',exact:true}).selectOption('side');await panel.getByRole('spinbutton',{name:'구성 수량 2',exact:true}).fill('2');
  await panel.getByRole('spinbutton',{name:'번들 가격(원)',exact:true}).fill('9000');await panel.getByLabel('번들 가격 승인').check();await panel.getByRole('spinbutton',{name:'계획 판매 수량',exact:true}).fill('3');
  await panel.getByRole('textbox',{name:'구매 링크',exact:true}).fill('https://example.com/set');await panel.getByRole('textbox',{name:'구매 이유',exact:true}).fill('한 번에 준비');
  const attempts:string[]=[];let lose=true;await page.route('**/api/growth/bundles',async route=>{if(route.request().method()==='POST'){attempts.push(route.request().postDataJSON().requestId);if(lose){lose=false;await route.fetch();await route.abort('failed');return;}}await route.continue();});
  await panel.getByRole('button',{name:'번들 저장',exact:true}).click();await expect(panel.getByRole('alert')).toContainText('입력은 보존했습니다');
  await panel.getByRole('button',{name:'번들 저장',exact:true}).click();await expect(panel.getByRole('status').filter({hasText:'번들을 저장했습니다'})).toBeVisible();expect(attempts[0]).toBe(attempts[1]);
  await expect(panel).toContainText('원가 3,000원 · 공헌이익 6,000원 · 정가 합 10,000원');await expect(panel).toContainText('만들 수 있는 번들 2개 · 계획 3개');await expect(panel).toContainText('계획 수량(3)보다 만들 수 있는 번들(2)이 적습니다.');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1)).toBe(true);
 }finally{await context.close()}
});
