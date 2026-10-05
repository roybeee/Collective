// Real Chromium/local D1. Fixture authentication; no external provider calls or production deletion.
import {test,expect} from '@playwright/test';
import {randomUUID} from 'node:crypto';

test('출처 정책 차단과 수집 OFF 보존 현황',async({browser},info)=>{
 const context=await browser.newContext({baseURL:info.project.use.baseURL,viewport:info.project.use.viewport,extraHTTPHeaders:{'oai-authenticated-user-id':`policy-${info.project.name}-${randomUUID()}`}});
 const page=await context.newPage();
 try{
  await page.request.get('/api/workspace');
  // Both feature switches are initially OFF; inventory remains available.
  const first=await page.request.get('/api/product-research?view=retention');
  expect(first.status()).toBe(200);
  expect(await first.json()).toMatchObject({complete:true,scanned:0,automaticDeletion:false});
  await page.request.post('/api/feature-flags',{data:{action:'set',flag:'product_research',enabled:true}});
  await page.goto('/?view=research&tab=sources');
  for(const name of ['네이버 검색광고 연결','YouTube 연결']){
   const card=page.getByRole('region',{name,exact:true});
   await expect(card.getByRole('button',{name:'연결 저장',exact:true})).toBeDisabled();
   await expect(card.getByRole('status')).toContainText('사용 보류');
  }
  const rejected=await page.request.post('/api/product-research',{data:{action:'connect_source',requestId:randomUUID(),credentialKey:'naver_searchad',input:{}}});
  expect(rejected.status()).toBe(409);
  await page.getByRole('button',{name:'보존 상태 확인',exact:true}).click();
  await expect(page.getByText('조회 범위 확인 완료',{exact:false})).toBeVisible();
  await expect(page.getByRole('table',{name:'수집 자료 보존 현황'})).toBeVisible();
  const after=await page.request.get('/api/product-research');
  expect((await after.json()).collectEnabled).toBe(false);
 }finally{await context.close()}
});
