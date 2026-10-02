import {test,expect} from '@playwright/test';
// UX-PLAN-3 12차원 4점 조건 '빈 상태는 다음 행동': 빈 목록의 '첫 ○○ 쓰기'가 폼을 열고 첫 칸으로 이동한다.
// Real local D1/API/Chromium. 인증 헤더 mocked. 외부 호출 없음.
test('빈 목록의 첫 쓰기 버튼이 폼을 열고 첫 칸으로 이동한다',async({browser},info)=>{
 const context=await browser.newContext({baseURL:info.project.use.baseURL,viewport:info.project.use.viewport,extraHTTPHeaders:{'oai-authenticated-user-id':`empty-${info.project.name}-${Date.now()}`}}),page=await context.newPage();
 try{
  await page.request.get('/api/workspace');
  const post=async(data:unknown)=>{const r=await page.request.post('/api/action',{data});expect(r.status(),await r.text()).toBe(200);return r.json()};
  const {id:campaignId}=await post({action:'save_campaign',data:{brandId:'ofd',title:'빈 상태 확인',goal:'빈 상태'}});
  await page.goto(`/?view=campaigns&campaign=${campaignId}&ctab=growth`);
  await page.locator('summary').filter({hasText:/^여러 상품 번들$/}).click();
  const panel=page.getByRole('region',{name:'번들 오퍼',exact:true});await expect(panel).toContainText('번들이 없습니다.');
  await panel.getByRole('button',{name:'첫 번들 쓰기',exact:true}).click();
  await expect(panel.getByRole('textbox',{name:'번들명',exact:true})).toBeFocused();
 }finally{await context.close()}
});
