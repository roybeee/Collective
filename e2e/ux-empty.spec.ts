import {test,expect} from '@playwright/test';
// UX-PLAN-3 12차원 4점 조건 '빈 상태는 다음 행동': 빈 목록은 다음 행동 문장이나 '첫 ○○ 쓰기' 버튼을 보인다.
// Real local D1/API/Chromium. 인증 헤더 mocked. 외부 호출 없음.
test('빈 목록은 다음 행동을 보이고, 첫 쓰기 버튼은 쓰기 칸으로 이동한다',async({browser},info)=>{
 const context=await browser.newContext({baseURL:info.project.use.baseURL,viewport:info.project.use.viewport,extraHTTPHeaders:{'oai-authenticated-user-id':`empty-${info.project.name}-${Date.now()}`}}),page=await context.newPage();
 try{
  await page.request.get('/api/workspace');
  const post=async(data:unknown)=>{const r=await page.request.post('/api/action',{data});expect(r.status(),await r.text()).toBe(200);return r.json()};
  const {id:campaignId}=await post({action:'save_campaign',data:{brandId:'ofd',title:'빈 상태 확인',goal:'빈 상태'}});
  await page.goto(`/?view=campaigns&campaign=${campaignId}&ctab=growth`);
  // '새 ○○' 버튼이 있는 패널은 빈 목록이 그 버튼을 가리키는 문장을 보인다(같은 동작 버튼을 두 번 두지 않는다).
  await page.locator('summary').filter({hasText:/^여러 상품 번들$/}).click();
  const panel=page.getByRole('region',{name:'번들 오퍼',exact:true});await expect(panel).toContainText('번들이 없습니다. 위 ‘새 번들’ 버튼으로 시작하세요.');
  await expect(panel.getByRole('button',{name:/^첫 /})).toHaveCount(0);
  // '새 ○○' 버튼이 없는 패널은 '첫 ○○ 쓰기'가 같은 패널 쓰기 칸으로 이동한다(AI 팀 탭의 상시 지시).
  await page.goto(`/?view=campaigns&campaign=${campaignId}&ctab=team`);
  await page.getByRole('button',{name:'첫 상시 지시 쓰기',exact:true}).click();
  await expect(page.getByRole('textbox',{name:'상시 지시',exact:true})).toBeFocused();
 }finally{await context.close()}
});
