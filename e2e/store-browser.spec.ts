// 실제 로컬 Chromium/D1. 인증 fixture, 네이버 호출 없음.
import {test,expect} from '@playwright/test';

test('네이버 시간 변경안은 승인 후 대기하며 새로고침으로 보존된다',async({browser},info)=>{
 const context=await browser.newContext({baseURL:info.project.use.baseURL,viewport:info.project.use.viewport,extraHTTPHeaders:{'oai-authenticated-user-id':`browser-${info.project.name}-${Date.now()}`}});
 const page=await context.newPage();
 const post=async(url:string,data:Record<string,unknown>)=>{const r=await page.request.post(url,{data});expect(r.status(),await r.text()).toBe(200);return r.json()};
 try{
  await page.request.get('/api/workspace');
  await post('/api/feature-flags',{action:'set',flag:'store_browser_execution',enabled:true});
  const store=await post('/api/stores',{action:'save_store',brandId:'ofd',data:{name:'브라우저 합성 매장',address:'합성 주소',tradeArea:'residential',goal:'영업시간 확인'}});
  const registered=await post('/api/store-browser',{action:'register_device',label:'테스트 컴퓨터',profileId:'u0'});
  await post('/api/store-browser',{action:'save_binding',storeId:store.id,naverPlaceId:'10001',managerBusinessId:'20002',managerUrl:'https://new.smartplace.naver.com/bizes/place/20002',deviceId:registered.device.id,profileId:'u0'});
  await page.goto(`/?view=stores&brand=ofd&store=${encodeURIComponent(store.id)}&tab=channels`);
  const panel=page.getByRole('region',{name:'네이버 매장 관리',exact:true});
  await expect(panel).toBeVisible();
  await panel.getByRole('textbox',{name:'현재 영업시간',exact:true}).fill('월~금 10:00–18:00');
  await panel.getByRole('textbox',{name:'변경할 영업시간',exact:true}).fill('월~금 10:00–19:00');
  await panel.getByRole('button',{name:'변경안 만들기',exact:true}).click();
  await expect(panel.getByText('승인 대기',{exact:false})).toBeVisible();
  await panel.getByRole('button',{name:'위 내용으로 변경 승인',exact:true}).click();
  await expect(panel.getByText('실행 대기',{exact:false})).toBeVisible();
  await page.reload();
  await expect(panel.getByText('월~금 10:00–19:00',{exact:true})).toBeVisible();
  const r=await page.request.get('/api/store-browser?storeId='+store.id),listing=await r.json();
  expect(listing.jobs).toHaveLength(1);expect(listing.jobs[0].status).toBe('approved');
  expect(listing.jobs[0].submissionStartedAt).toBeUndefined();
  await post('/api/feature-flags',{action:'set',flag:'store_browser_execution',enabled:false});
  await page.reload();await expect(panel.getByText('새 작업이 꺼져 있습니다.',{exact:false})).toBeVisible();
  await expect(panel.getByRole('button',{name:'변경안 만들기',exact:true})).toHaveCount(0);
  await panel.getByRole('button',{name:'연결 해제',exact:true}).click();
  await expect(panel.getByRole('button',{name:'연결 해제',exact:true})).toHaveCount(0);
  await panel.getByRole('button',{name:'취소',exact:true}).click();
  await expect(panel.getByText(/영업시간 변경,\s*취소/)).toBeVisible();
  const cancelled=await (await page.request.get('/api/store-browser?storeId='+store.id)).json();
  expect(cancelled.jobs[0].status).toBe('cancelled');expect(cancelled.devices[0].status).toBe('revoked');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
 }finally{await context.close()}
});
