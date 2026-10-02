import {test,expect} from '@playwright/test';
// UX-PLAN-3 1차원 4점 조건 '탭은 주소에 남는다': 브랜드 아카이브 탭을 바꾸면 주소(?tab=)가 바뀌고, 새로고침해도 같은 탭이 열린다.
// Real local D1/API/Chromium. 인증 헤더 mocked. 외부 호출 없음.
test('브랜드 아카이브 탭이 주소에 남고 새로고침 뒤에도 유지된다',async({browser},info)=>{
 const context=await browser.newContext({baseURL:info.project.use.baseURL,viewport:info.project.use.viewport,extraHTTPHeaders:{'oai-authenticated-user-id':`address-${info.project.name}-${Date.now()}`}}),page=await context.newPage();
 try{
  await page.request.get('/api/workspace');
  await page.goto('/?view=brands&brand=ofd');
  await page.getByRole('tab',{name:/^자료 아카이브/}).click();
  await expect(page).toHaveURL(/tab=sources/);
  await page.reload();
  await expect(page.getByRole('tab',{name:/^자료 아카이브/})).toHaveAttribute('aria-selected','true');
 }finally{await context.close()}
});
